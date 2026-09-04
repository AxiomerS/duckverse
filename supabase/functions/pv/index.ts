// Supabase Edge Function "pv": СЕРВЕРНЫЙ баланс PV (единственный источник правды).
// БЕЗ внешних зависимостей. JWT wallet-auth (как в sell). Пишет в public.balances через service_role.
// Клиент шлёт { action, ... } с Bearer-JWT кошелька; сервер валидирует и возвращает новый баланс.
// Действия: sync | collect | daily | spend | roulette | battle | run-reward.
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// --- Экономические константы (держать в синхроне с клиентом, где нужно для показа) ---
const PASSIVE_PER_MIN = 2;              // базовый пассив PV/мин (BASE_SIL_PER_MIN)
const COLLECT_CAP_MS = 15 * 60 * 1000;  // не более 15 мин пассива за один collect
const MULT_CAP = 3;                     // потолок множителя уровня (защита от спуфа level)
const DAILY_REWARD = 50;
const DAILY_COOLDOWN = 2 * 3600 * 1000; // дейли раз в 2 часа
const BATTLE_MAX_PER_DAY = 3000;        // дневной кэп выигрыша на арене (won доверяем — Phase 1)
const RUN_REWARD_COOLDOWN = 3600 * 1000;
const PLAYER_MIN = 10;                  // PV за арену включается только когда игроков в игре > 10
// Награда за топ в Ranks (run-reward) открывается ОДИН РАЗ НА ВСЮ ИГРУ, спустя это время после
// момента, когда игроков впервые стало больше PLAYER_MIN — так все получают доступ ОДНОВРЕМЕННО,
// а не по индивидуальному кулдауну с разного момента (см. milestones/mark_milestone_once в SQL).
const RUN_REWARD_UNLOCK_DELAY = 2 * 3600 * 1000;
const STAKES = new Set([5, 10, 25, 50, 100, 200]);
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function colorOf(n: number): "green" | "red" | "black" { return n === 0 ? "green" : RED.has(n) ? "red" : "black"; }
function levelMult(level: number): number { return Math.min(1 + (Math.max(1, level | 0) - 1) * 0.1, MULT_CAP); }
function runRewardForRank(rank: number): number { return rank <= 3 ? 500 : rank <= 8 ? 200 : rank <= 10 ? 100 : 50; }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResp(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
function sbHeaders(e?: Record<string, string>) {
  return { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...e };
}
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}
async function walletFromJwt(auth: string | null): Promise<string | null> {
  const t = (auth ?? "").replace(/^Bearer /, "");
  const p = t.split(".");
  if (p.length !== 3) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(p[2]), new TextEncoder().encode(p[0] + "." + p[1]));
  if (!ok) return null;
  const pl = JSON.parse(new TextDecoder().decode(b64urlToBytes(p[1])));
  if (pl.exp && pl.exp * 1000 < Date.now()) return null;
  return pl.wallet ?? null;
}

type Bal = { wallet: string; coins: number; last_daily: number; last_collect: number; last_run_reward: number; battle_day: number; battle_gain: number };

// Получить строку баланса; если её нет — создать из текущего сейва (ленивый бэкфилл).
// resolution=ignore-duplicates -> INSERT ... ON CONFLICT DO NOTHING: если строку только что создал
// параллельный запрос (гонка при самом первом обращении кошелька), наш INSERT молча ничего не делает,
// а не ПЕРЕЗАПИСЫВАЕТ (как было с merge-duplicates) уже атомарно изменённый другим запросом баланс.
// Возвращённый `row` в этом случае может быть устаревшим (не тот, что реально в базе), но это не
// страшно: все последующие мутации идут через отдельные атомарные pv_* RPC, читающие текущую строку
// заново — `row` тут используется только для чтения last_daily в ответе sync/collect.
async function getOrCreate(wallet: string): Promise<Bal> {
  const rows = await fetch(`${SB_URL}/rest/v1/balances?wallet=eq.${encodeURIComponent(wallet)}&select=*`, { headers: sbHeaders() }).then((r) => r.json());
  if (rows?.[0]) return rows[0] as Bal;
  const saveRows = await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: sbHeaders() }).then((r) => r.json());
  const coins = Math.floor(Number(saveRows?.[0]?.data?.coins ?? 0)) || 0;
  const now = Date.now();
  const row = { wallet, coins, last_daily: 0, last_collect: now, last_run_reward: 0, battle_day: 0, battle_gain: 0 };
  await fetch(`${SB_URL}/rest/v1/balances`, { method: "POST", headers: sbHeaders({ Prefer: "return=minimal,resolution=ignore-duplicates" }), body: JSON.stringify({ ...row, updated_at: new Date(now).toISOString() }) });
  return row;
}
// Вызвать атомарную SQL-функцию баланса. Возвращает новый баланс (number) или null, если условие
// внутри функции не выполнилось (кулдаун не прошёл / не хватает PV) — тогда 0 строк → NULL.
async function rpc(fn: string, args: Record<string, unknown>): Promise<number | null> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: sbHeaders(), body: JSON.stringify(args) });
  const data = await res.json().catch(() => null);
  const v = Array.isArray(data) ? data[0] : data;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Сколько игроков в игре (кол-во сейвов). Через заголовок Content-Range (Prefer: count=exact).
async function playerCount(): Promise<number> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/saves?select=wallet&limit=1`, { headers: sbHeaders({ Prefer: "count=exact" }) });
    const cr = res.headers.get("content-range") ?? "";
    return Number(cr.split("/")[1] ?? 0) || 0;
  } catch {
    return 0;
  }
}

// Момент (epoch ms), когда игроков впервые стало больше PLAYER_MIN — null, если ещё не набралось.
// Один раз записанное значение больше не меняется (mark_milestone_once — INSERT..ON CONFLICT DO NOTHING),
// поэтому после первой записи не дёргаем дорогой playerCount() снова — просто читаем строку.
async function playersMilestoneAt(now: number): Promise<number | null> {
  const rows = await fetch(`${SB_URL}/rest/v1/milestones?key=eq.players_min&select=at`, { headers: sbHeaders() }).then((r) => r.json());
  const existing = rows?.[0]?.at;
  if (typeof existing === "number") return existing;
  if ((await playerCount()) <= PLAYER_MIN) return null;
  const res = await fetch(`${SB_URL}/rest/v1/rpc/mark_milestone_once`, { method: "POST", headers: sbHeaders(), body: JSON.stringify({ p_key: "players_min", p_now: now }) });
  const v = await res.json().catch(() => null);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const wallet = await walletFromJwt(req.headers.get("Authorization"));
    if (!wallet) return jsonResp({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const level = Number(body.level) || 1;
    const now = Date.now();
    const b = await getOrCreate(wallet); // гарантируем строку баланса; сами мутации — атомарно через RPC

    if (action === "sync" || action === "collect") {
      const rate = PASSIVE_PER_MIN * levelMult(level);
      const coins = await rpc("pv_collect", { p_wallet: wallet, p_rate: rate, p_cap_ms: COLLECT_CAP_MS, p_now: now });
      // Заодно фиксируем веху "10+ игроков", если она ещё не наступила — sync/collect дёргается
      // всеми активными игроками каждые ~20с, так что порог отловится почти сразу, как будет пройден.
      const milestoneAt = await playersMilestoneAt(now);
      const runRewardUnlockAt = milestoneAt !== null ? milestoneAt + RUN_REWARD_UNLOCK_DELAY : null;
      return jsonResp({ coins: Math.floor(coins ?? b.coins), lastDaily: b.last_daily, runRewardUnlockAt });
    }

    if (action === "daily") {
      const coins = await rpc("pv_daily", { p_wallet: wallet, p_reward: DAILY_REWARD, p_cooldown: DAILY_COOLDOWN, p_now: now });
      if (coins === null) return jsonResp({ error: "daily not ready", coins: Math.floor(b.coins) }, 409);
      return jsonResp({ coins: Math.floor(coins), credited: DAILY_REWARD });
    }

    if (action === "spend") {
      const amount = Math.ceil(Number(body.amount));
      if (!(amount > 0)) return jsonResp({ error: "bad amount" }, 400);
      const coins = await rpc("pv_spend", { p_wallet: wallet, p_amount: amount });
      if (coins === null) return jsonResp({ error: "not enough PV", coins: Math.floor(b.coins) }, 409);
      return jsonResp({ coins: Math.floor(coins), spent: amount });
    }

    if (action === "roulette") {
      const stake = Number(body.stake);
      const bet = body.bet as "red" | "black" | "zero";
      if (!STAKES.has(stake) || (bet !== "red" && bet !== "black" && bet !== "zero")) return jsonResp({ error: "bad bet" }, 400);
      const win = bet === "zero" ? Math.random() < 1 / 36 : Math.random() < 1 / 2;
      // Подбираем номер кармана под исход (для анимации колеса на клиенте).
      const all = Array.from({ length: 37 }, (_, i) => i);
      let pool: number[];
      if (bet === "zero") pool = win ? [0] : all.filter((n) => n !== 0);
      else pool = win ? all.filter((n) => colorOf(n) === bet) : all.filter((n) => colorOf(n) !== bet);
      const n = pool[Math.floor(Math.random() * pool.length)];
      const payout = win ? (bet === "zero" ? stake * 15 : stake * 2) : 0;
      // Атомарно: списать ставку (при coins≥stake) и начислить выигрыш одним UPDATE.
      const coins = await rpc("pv_add_checked", { p_wallet: wallet, p_delta: payout - stake, p_min: stake });
      if (coins === null) return jsonResp({ error: "not enough PV", coins: Math.floor(b.coins) }, 409);
      return jsonResp({ coins: Math.floor(coins), win, n, color: colorOf(n) });
    }

    if (action === "battle") {
      // PV за арену — только когда игроков в игре стало больше 10 (иначе бой без PV: ставка не списывается/не выигрывается).
      if ((await playerCount()) <= PLAYER_MIN) return jsonResp({ coins: Math.floor(b.coins), locked: true });
      const stake = Math.max(0, Math.min(200, Number(body.stake) || 0));
      const won = !!body.won;
      const day = Math.floor(now / 86400000);
      const reward = Math.min(40 + Math.max(1, level | 0) * 10, 200); // капим награду (level не доверяем)
      const coins = await rpc("pv_battle", { p_wallet: wallet, p_won: won, p_stake: stake, p_reward: reward, p_day: day, p_max: BATTLE_MAX_PER_DAY });
      return jsonResp({ coins: Math.floor(coins ?? b.coins) });
    }

    if (action === "run-reward") {
      // PV за ритм-игру (награда за топ) — открывается ОДНОВРЕМЕННО у всех, спустя
      // RUN_REWARD_UNLOCK_DELAY после того, как игроков в игре впервые стало больше PLAYER_MIN.
      const milestoneAt = await playersMilestoneAt(now);
      const unlockAt = milestoneAt !== null ? milestoneAt + RUN_REWARD_UNLOCK_DELAY : null;
      if (unlockAt === null || now < unlockAt) {
        return jsonResp({ error: "rewards unlock 2h after the game reaches 10+ players", coins: Math.floor(b.coins), locked: true, runRewardUnlockAt: unlockAt }, 409);
      }
      // Ранг считаем НА СЕРВЕРЕ из scores (не доверяем клиенту). Сам счёт клиентский → награда капнута.
      const myRows = await fetch(`${SB_URL}/rest/v1/scores?wallet=eq.${encodeURIComponent(wallet)}&select=score`, { headers: sbHeaders() }).then((r) => r.json());
      const myScore = Number(myRows?.[0]?.score ?? 0);
      if (!(myScore > 0)) return jsonResp({ error: "no score yet", coins: Math.floor(b.coins) }, 409);
      const greater = await fetch(`${SB_URL}/rest/v1/scores?select=wallet&score=gt.${myScore}&limit=1000`, { headers: sbHeaders() }).then((r) => r.json());
      const rank = (Array.isArray(greater) ? greater.length : 0) + 1;
      const reward = runRewardForRank(rank);
      const coins = await rpc("pv_run_reward", { p_wallet: wallet, p_reward: reward, p_cooldown: RUN_REWARD_COOLDOWN, p_now: now });
      if (coins === null) return jsonResp({ error: "not ready", coins: Math.floor(b.coins) }, 409);
      return jsonResp({ coins: Math.floor(coins), credited: reward });
    }

    return jsonResp({ error: "unknown action" }, 400);
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
