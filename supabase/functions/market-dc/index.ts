// Supabase Edge Function "market-dc": маркетплейс уток за DC, между игроками, без цепочки.
// БЕЗ внешних зависимостей. JWT wallet-auth, как в pv: подходит и кошельку, и гостю — для сервера
// это просто строка-идентификатор. Пишет в public.listings и public.pet_ledger через service_role.
//
// Чем отличается от market-buy (старый маркетплейс за ETH): там покупатель шлёт ETH на кошелёк
// продавца, сервер ждёт транзакцию в сети и подтверждает её, а выплату продавцу админ одобряет
// руками. Здесь платят внутриигровыми DC, которые и так живут на сервере, поэтому вся сделка это
// одна SQL-транзакция: списать с покупателя, начислить продавцу за вычетом комиссии, передать
// утку, убрать лот. Ждать нечего и подтверждать нечего.
//
// Действия: list | buy | cancel.
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const FEE_PCT = 5;          // комиссия площадки: сгорает, единственный сток DC в экономике
const MAX_PRICE = 1_000_000; // потолок цены лота, чтобы опечатка не создала лот на миллиарды

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
// Вызвать SQL-функцию. Возвращает её результат или null, если условие внутри не выполнилось.
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: sbHeaders(), body: JSON.stringify(args) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (Array.isArray(data) ? data[0] : data) ?? null;
}
async function getRows(path: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  return r.ok ? await r.json() : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const me = await walletFromJwt(req.headers.get("Authorization"));
    if (!me) return jsonResp({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // Выставить утку. Уровень, баффы и имя берём из ЛЕДЖЕРА, а не из тела запроса: иначе продавец
    // мог бы выставить утку 1 уровня как утку 30-го. Аксессуары приходят от клиента — серверного
    // владения у них пока нет, они едут на утке как ярлык (см. заметку в CLAUDE.md).
    if (action === "list") {
      const species = String(body.species ?? "");
      const price = Math.floor(Number(body.price));
      const accessories = Array.isArray(body.accessories) ? body.accessories.slice(0, 8).map(String) : [];
      if (!species) return jsonResp({ error: "bad species" }, 400);
      if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return jsonResp({ error: "bad price" }, 400);
      const owned = await getRows(`pet_ledger?wallet=eq.${encodeURIComponent(me)}&species=eq.${encodeURIComponent(species)}&select=level,buffs,name`);
      const row = owned[0];
      if (!row) return jsonResp({ error: "you don't own this duck" }, 409);
      const id = `d${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const ok = await rpc<boolean>("dcm_list", {
        p_seller: me, p_id: id, p_species: species, p_price: price,
        p_level: Number(row.level) || 1, p_buffs: row.buffs ?? [], p_name: row.name ?? "", p_accessories: accessories,
      });
      if (ok !== true) return jsonResp({ error: "you don't own this duck" }, 409);
      return jsonResp({ id, price, fee: FEE_PCT });
    }

    if (action === "buy") {
      const id = String(body.id ?? "");
      if (!id) return jsonResp({ error: "bad listing" }, 400);
      const lots = await getRows(`listings?id=eq.${encodeURIComponent(id)}&select=seller,species,price,currency,accessories`);
      const lot = lots[0];
      if (!lot || lot.currency !== "dc") return jsonResp({ error: "listing is gone" }, 409);
      if (lot.seller === me) return jsonResp({ error: "that's your own listing" }, 409);
      const mine = await getRows(`pet_ledger?wallet=eq.${encodeURIComponent(me)}&species=eq.${encodeURIComponent(String(lot.species))}&select=species`);
      if (mine[0]) return jsonResp({ error: "you already own this duck" }, 409);
      const coins = await rpc<number>("dcm_buy", { p_buyer: me, p_id: id, p_fee_pct: FEE_PCT });
      if (coins === null) return jsonResp({ error: "not enough PV" }, 409);
      return jsonResp({ coins: Math.floor(coins), species: lot.species, accessories: lot.accessories ?? [] });
    }

    if (action === "cancel") {
      const id = String(body.id ?? "");
      if (!id) return jsonResp({ error: "bad listing" }, 400);
      const ok = await rpc<boolean>("dcm_cancel", { p_seller: me, p_id: id });
      if (ok !== true) return jsonResp({ error: "listing is gone" }, 409);
      return jsonResp({ ok: true });
    }

    return jsonResp({ error: "bad action" }, 400);
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
