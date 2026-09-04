// Supabase Edge Function "battle-live": матчмейкинг для LIVE PvP (Battle Arena).
// БЕЗ внешних зависимостей. JWT wallet-auth (как в pv/pets). Пишет в public.battle_queue через
// service_role — клиенты НЕ могут писать друг другу в очередь напрямую (RLS только на чтение своей
// строки), матчинг делает только эта функция через атомарную SQL-функцию battle_queue_poll (лочит
// строку соперника `for update skip locked`, чтобы 2 одновременных poll не схватили одного дважды).
// Действия: poll | leave.
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const wallet = await walletFromJwt(req.headers.get("Authorization"));
    if (!wallet) return jsonResp({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "poll") {
      const name = String(body.name ?? "").slice(0, 40);
      const species = String(body.species ?? "");
      const level = Math.max(1, Math.floor(Number(body.level) || 1));
      const accessories = Array.isArray(body.accessories) ? body.accessories.slice(0, 8) : [];
      const bet = Math.max(0, Math.min(200, Number(body.bet) || 0));
      if (!species) return jsonResp({ error: "bad fighter" }, 400);
      const res = await fetch(`${SB_URL}/rest/v1/rpc/battle_queue_poll`, {
        method: "POST",
        headers: sbHeaders(),
        body: JSON.stringify({ p_wallet: wallet, p_name: name, p_species: species, p_level: level, p_accessories: accessories, p_bet: bet, p_now: Date.now() }),
      });
      const data = await res.json().catch(() => null);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return jsonResp({ error: "matchmaking failed" }, 500);
      return jsonResp({ status: row.status, matchId: row.match_id ?? null, opponent: row.opponent ?? null });
    }

    if (action === "leave") {
      await fetch(`${SB_URL}/rest/v1/rpc/battle_queue_leave`, { method: "POST", headers: sbHeaders(), body: JSON.stringify({ p_wallet: wallet }) });
      return jsonResp({ ok: true });
    }

    if (action === "finish") {
      const matchId = String(body.matchId ?? "");
      if (matchId) await fetch(`${SB_URL}/rest/v1/rpc/battle_queue_finish`, { method: "POST", headers: sbHeaders(), body: JSON.stringify({ p_match_id: matchId }) });
      return jsonResp({ ok: true });
    }

    return jsonResp({ error: "unknown action" }, 400);
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
