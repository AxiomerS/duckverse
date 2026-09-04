// Supabase Edge Function "pets": СЕРВЕРНОЕ владение питомцами (единственный источник правды — pet_ledger).
// БЕЗ внешних зависимостей. JWT wallet-auth (как в pv/sell). Пишет в public.pet_ledger / public.listings
// через service_role. Клиент шлёт { action, ... } с Bearer-JWT кошелька; сервер валидирует.
// Действия: starter | chest | breed | list | cancel.
//
// Почему это нужно: раньше браузер сам вписывал питомца в ownedSpecies и сам создавал лот. Крафтнутый
// сейв мог сфабриковать пета и продать за реальный SOL. Теперь пет попадает в леджер ТОЛЬКО через сервер,
// а выставить на продажу можно лишь то, что сервер видит в леджере (pet_take заберёт запись).
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// --- Данные, которым НЕЛЬЗЯ доверять клиенту (держать в синхроне с src/game/*) ---
// Виды и их редкость (src/game/pets.ts). Обычные (common) — стартовые, из сундука/разведения не падают.
const PETS: { id: string; r: string }[] = [
  { id: "dog", r: "common" }, { id: "cat", r: "common" }, { id: "hamster", r: "common" },
  { id: "rabbit", r: "rare" }, { id: "frog", r: "rare" }, { id: "penguin", r: "rare" },
  { id: "fox", r: "epic" }, { id: "panda", r: "epic" }, { id: "owl", r: "epic" },
  { id: "lion", r: "legendary" }, { id: "tiger", r: "legendary" }, { id: "unicorn", r: "legendary" },
  { id: "dragon", r: "mythic" }, { id: "dino", r: "mythic" },
];
const rarityOf = (id: string): string => PETS.find((p) => p.id === id)?.r ?? "";
// Сундуки питомцев (src/game/chests.ts) — цена в PV + шансы редкости.
const PET_CHESTS: Record<string, { cost: number; odds: Record<string, number> }> = {
  "egg": { cost: 150, odds: { rare: 40, epic: 40, legendary: 16, mythic: 4 } },
  "golden-egg": { cost: 340, odds: { rare: 8, epic: 35, legendary: 40, mythic: 17 } },
};
const BREED_COST = 1000;                                            // App.tsx BREED_COST (без скидки магазина)
const BREED_LEVEL = 5;                                             // родители должны быть ≥ этого уровня
const BREED_ODDS: Record<string, number> = { rare: 25, epic: 40, legendary: 27, mythic: 8 };
// Скидки магазина от перка активного вида (src/game/pets.ts SPECIES_PERK; влияет на цену сундука).
const SHOP_DISCOUNT: Record<string, number> = { fox: 0.1, dragon: 0.25 };

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

// Вызвать атомарную SQL-функцию (pv_spend / pet_grant / pet_take) и вернуть массив строк ответа.
async function rpc(fn: string, args: Record<string, unknown>): Promise<any[]> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: sbHeaders(), body: JSON.stringify(args) });
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : data == null ? [] : [data];
}
// Списать PV на сервере (переиспользуем существующую атомарную pv_spend). null = не хватило баланса.
async function spend(wallet: string, amount: number): Promise<number | null> {
  const rows = await rpc("pv_spend", { p_wallet: wallet, p_amount: amount });
  const v = rows[0];
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
}
// Строки леджера игрока (виды, которыми владеет), с уровнем.
async function ownedRows(wallet: string): Promise<{ species: string; level: number }[]> {
  const rows = await fetch(`${SB_URL}/rest/v1/pet_ledger?wallet=eq.${encodeURIComponent(wallet)}&select=species,level`, { headers: sbHeaders() }).then((r) => r.json());
  return Array.isArray(rows) ? rows : [];
}

// Выбрать редкость по шансам сундука/разведения (реплика rollRarity из клиента).
function rollRarity(odds: Record<string, number>): string {
  const entries = Object.entries(odds);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [rar, w] of entries) { r -= w; if (r <= 0) return rar; }
  return entries[entries.length - 1][0];
}
// Выбрать вид: сначала бросаем редкость по шансам, берём НЕобычный невладеемый вид этой редкости;
// если такого нет — любой невладеемый (реплика openPetChest, App.tsx). null = владеет всеми.
function rollSpecies(owned: Set<string>, odds: Record<string, number>): string | null {
  const missing = PETS.filter((p) => p.r !== "common" && !owned.has(p.id));
  if (missing.length === 0) return null;
  const rar = rollRarity(odds);
  const pool = missing.filter((p) => p.r === rar);
  const from = pool.length ? pool : missing;
  return from[Math.floor(Math.random() * from.length)].id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const wallet = await walletFromJwt(req.headers.get("Authorization"));
    if (!wallet) return jsonResp({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // starter — бесплатный первый питомец при создании аккаунта. Только если леджер пуст (не даём
    // фармить лишних обычных бесплатно) и вид действительно обычный (common).
    if (action === "starter") {
      const species = String(body.species ?? "");
      if (rarityOf(species) !== "common") return jsonResp({ error: "not a starter" }, 400);
      const owned = await ownedRows(wallet);
      if (owned.length > 0) return jsonResp({ ok: true, already: true }); // старт уже был
      await rpc("pet_grant", { p_wallet: wallet, p_species: species, p_level: 1, p_buffs: [], p_name: body.name ?? null, p_source: "starter" });
      return jsonResp({ ok: true, species });
    }

    // chest — открыть сундук питомца: сервер решает вид, списывает PV, выдаёт в леджер.
    if (action === "chest") {
      const chest = PET_CHESTS[String(body.chestId ?? "")];
      if (!chest) return jsonResp({ error: "bad chest" }, 400);
      const owned = await ownedRows(wallet);
      const ownedSet = new Set(owned.map((o) => o.species));
      const species = rollSpecies(ownedSet, chest.odds);
      if (!species) return jsonResp({ error: "own all" }, 409);
      // Скидка магазина — только если активный вид действительно во владении (иначе спуф −25%).
      const active = String(body.active ?? "");
      const disc = ownedSet.has(active) ? (SHOP_DISCOUNT[active] ?? 0) : 0;
      const cost = Math.ceil(chest.cost * (1 - disc));
      const coins = await spend(wallet, cost);
      if (coins === null) return jsonResp({ error: "not enough PV" }, 409);
      await rpc("pet_grant", { p_wallet: wallet, p_species: species, p_level: 1, p_buffs: [], p_name: null, p_source: "chest" });
      return jsonResp({ coins: Math.floor(coins), species, rarity: rarityOf(species) });
    }

    // breed — скрестить двух СВОИХ питомцев уровня 5+ → новый вид. Родителей проверяем по леджеру.
    if (action === "breed") {
      const parents: string[] = Array.isArray(body.parents) ? body.parents.map(String) : [];
      if (parents.length !== 2 || parents[0] === parents[1]) return jsonResp({ error: "pick two pets" }, 400);
      const owned = await ownedRows(wallet);
      const byId = new Map(owned.map((o) => [o.species, o.level]));
      for (const p of parents) {
        if (!byId.has(p)) return jsonResp({ error: "you don't own that pet" }, 409);
        if ((byId.get(p) ?? 1) < BREED_LEVEL) return jsonResp({ error: "parents must be level " + BREED_LEVEL }, 409);
      }
      const species = rollSpecies(new Set(byId.keys()), BREED_ODDS);
      if (!species) return jsonResp({ error: "own all" }, 409);
      const coins = await spend(wallet, BREED_COST);
      if (coins === null) return jsonResp({ error: "not enough PV" }, 409);
      await rpc("pet_grant", { p_wallet: wallet, p_species: species, p_level: 1, p_buffs: [], p_name: null, p_source: "breed" });
      return jsonResp({ coins: Math.floor(coins), species, rarity: rarityOf(species) });
    }

    // list — выставить пета на продажу: атомарно ЗАБИРАЕМ его из леджера (эскроу), затем создаём лот.
    // Уровень/баффы/имя берём с клиента (это лишь витрина, не источник денег): владение уже доказано
    // тем, что pet_take вернул строку. Не владеешь → pet_take пуст → лот не создаётся.
    if (action === "list") {
      const species = String(body.species ?? "");
      const price = Number(body.price);
      // Number.isFinite отсекает Infinity/NaN (просто "price > 0" пропускает Infinity) — иначе можно
      // выставить лот с ценой Infinity, который потом никто не сможет купить (сломанный листинг).
      if (!species || !Number.isFinite(price) || !(price > 0) || price > 100000) return jsonResp({ error: "bad listing" }, 400);
      const taken = await rpc("pet_take", { p_wallet: wallet, p_species: species });
      if (taken.length === 0) return jsonResp({ error: "you don't own this pet" }, 409);
      const row = taken[0];
      const level = Math.max(1, Number(body.level) || row.level || 1);
      const buffs = Array.isArray(body.buffs) ? body.buffs : (row.buffs ?? []);
      // Аксессуары, надетые на пета — уходят покупателю (косметика/сила, не денежный вектор → берём с клиента).
      const accessories = Array.isArray(body.accessories) ? body.accessories.map(String) : [];
      const name = (body.name ? String(body.name) : row.name) || null;
      const id = `l${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const listing = { id, seller: wallet, kind: "sale", species, level, buffs, accessories, name, price, created_at: new Date().toISOString() };
      const res = await fetch(`${SB_URL}/rest/v1/listings`, { method: "POST", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify(listing) });
      if (!res.ok) {
        // Лот не создался → возвращаем пета в леджер (иначе он потерян: изъят, но не выставлен).
        await rpc("pet_grant", { p_wallet: wallet, p_species: species, p_level: level, p_buffs: buffs, p_name: name, p_source: "grant" });
        return jsonResp({ error: "couldn't create listing" }, 500);
      }
      return jsonResp({ ok: true, listing });
    }

    // cancel — снять СВОЙ лот и вернуть пета в леджер. Если лот уже куплен — возвращать нечего.
    if (action === "cancel") {
      const id = String(body.id ?? "");
      if (!id) return jsonResp({ error: "bad id" }, 400);
      const deleted = await fetch(`${SB_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&seller=eq.${encodeURIComponent(wallet)}&kind=eq.sale`, {
        method: "DELETE",
        headers: sbHeaders({ Prefer: "return=representation" }),
      }).then((r) => r.json()).catch(() => []);
      if (Array.isArray(deleted) && deleted.length > 0) {
        const lot = deleted[0];
        await rpc("pet_grant", { p_wallet: wallet, p_species: lot.species, p_level: lot.level ?? 1, p_buffs: lot.buffs ?? [], p_name: lot.name ?? null, p_source: "grant" });
        return jsonResp({ ok: true, restored: true, species: lot.species, level: lot.level ?? 1, buffs: lot.buffs ?? [], accessories: lot.accessories ?? [], name: lot.name ?? null });
      }
      return jsonResp({ ok: true, restored: false }); // уже продан/снят
    }

    return jsonResp({ error: "unknown action" }, 400);
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
