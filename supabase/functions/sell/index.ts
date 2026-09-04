// Supabase Edge Function "sell": запрос на продажу PV за ETH. БЕЗ ключа казны и без выплаты —
// только СПИСЫВАЕТ PV из сейва (держит) и создаёт заявку status=pending. Реальную выплату ETH
// делает отдельная функция после ручного подтверждения админом.
// Продавца определяем из JWT (claim wallet), проверяя подпись тем же JWT_SECRET, что и в auth.
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RATE = 240000; // 240 000 PV → 1 ETH (пересчитано с прежних 10 000 PV за SOL по цене ETH/SOL)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function sbHeaders(extra?: Record<string, string>) {
  return { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...extra };
}
// Вызвать атомарную SQL-функцию баланса (pv_spend / pv_add_checked). Возвращает новый баланс или null.
async function rpcNum(fn: string, args: Record<string, unknown>): Promise<number | null> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: sbHeaders(), body: JSON.stringify(args) });
  const data = await res.json().catch(() => null);
  const v = Array.isArray(data) ? data[0] : data;
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
}
// Гарантировать строку баланса (ленивый бэкфилл из сейва) — чтобы атомарный UPDATE нашёл что менять.
// resolution=ignore-duplicates -> INSERT ... ON CONFLICT DO NOTHING: если строку только что создал
// параллельный запрос (гонка при самом первом обращении кошелька), наш INSERT молча ничего не делает,
// а не ПЕРЕЗАПИСЫВАЕТ (как было с merge-duplicates) уже атомарно изменённый другим запросом баланс.
async function ensureBalanceRow(wallet: string): Promise<void> {
  const brows = await fetch(`${SB_URL}/rest/v1/balances?wallet=eq.${encodeURIComponent(wallet)}&select=wallet`, { headers: sbHeaders() }).then((r) => r.json());
  if (brows?.[0]) return;
  const sRows = await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: sbHeaders() }).then((r) => r.json());
  const coins = Math.floor(Number(sRows?.[0]?.data?.coins ?? 0)) || 0;
  await fetch(`${SB_URL}/rest/v1/balances`, { method: "POST", headers: sbHeaders({ Prefer: "return=minimal,resolution=ignore-duplicates" }), body: JSON.stringify({ wallet, coins, last_collect: Date.now(), updated_at: new Date().toISOString() }) });
}
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// Проверить JWT (HS256) и вернуть claim wallet.
async function walletFromJwt(auth: string | null): Promise<string | null> {
  const token = (auth ?? "").replace(/^Bearer /, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  const p = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  if (p.exp && p.exp * 1000 < Date.now()) return null;
  return p.wallet ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const wallet = await walletFromJwt(req.headers.get("Authorization"));
    if (!wallet) return jsonResp({ error: "unauthorized" }, 401);
    const { pv } = await req.json();
    if (!Number.isFinite(pv) || pv <= 0) return jsonResp({ error: "bad amount" }, 400);

    // АТОМАРНОЕ списание: гарантируем строку баланса, затем pv_spend (UPDATE ... WHERE coins >= pv
    // RETURNING). Так два одновременных запроса на продажу НЕ спишут PV дважды и не создадут двойную
    // выплату (double-spend → кража ETH из казны). null = не хватило PV.
    await ensureBalanceRow(wallet);
    const newCoins = await rpcNum("pv_spend", { p_wallet: wallet, p_amount: pv });
    if (newCoins === null) return jsonResp({ error: "not enough PV" }, 400);

    // Колонка sell_requests.sol осталась от Solana-эпохи — теперь в ней сумма в ETH.
    const sol = +(pv / RATE).toFixed(8);

    // Создаём заявку. Если не удалось — АТОМАРНО возвращаем удержанные PV.
    const id = `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const rec = await fetch(`${SB_URL}/rest/v1/sell_requests`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ id, wallet, pv, sol, status: "pending", created_at: new Date().toISOString() }),
    });
    if (!rec.ok) {
      await rpcNum("pv_add_checked", { p_wallet: wallet, p_delta: pv, p_min: 0 }); // вернуть удержанные PV
      return jsonResp({ error: "request failed (sell_requests table?)" }, 500);
    }

    return jsonResp({ ok: true, coins: newCoins, pv, sol });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
