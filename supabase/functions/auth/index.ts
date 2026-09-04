// Supabase Edge Function "auth": проверяет подпись EVM-кошелька и выдаёт Supabase-JWT.
// Клиент шлёт {wallet(0x…), message, signature(0x…)}. Проверяем EIP-191 (personal_sign) подпись,
// и если верна + свежая — возвращаем JWT (role=authenticated, claim wallet).
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ SOLANA-ВЕРСИИ (важно понимать, если будешь это читать позже):
// раньше подпись была ed25519, и её умел проверить встроенный в Deno Web Crypto — внешние
// библиотеки были не нужны вообще. У EVM подпись secp256k1, а адрес — это ХЭШ публичного ключа,
// а не сам ключ. Поэтому «просто проверить подпись» нельзя: нужно ВОССТАНОВИТЬ публичный ключ из
// подписи и сверить его хэш с адресом (ecrecover). Web Crypto так не умеет, поэтому здесь
// единственная внешняя зависимость во всём проекте — viem, подключённая через npm:-специфаер.
import { verifyMessage } from "npm:viem@2.21.55";

const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const MAX_AGE_MS = 5 * 60 * 1000; // подпись действительна 5 минут

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function b64url(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const data = `${head}.${body}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { wallet, message, signature } = await req.json();
    if (!wallet || !message || !signature) return jsonResp({ error: "missing fields" }, 400);

    // Адрес приводим к нижнему регистру — тем же способом, что и клиент (normalizeAddress в
    // wallet.ts). Иначе 0xAbC… и 0xabc… станут двумя разными игроками с разными сейвами.
    const addr = String(wallet).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) return jsonResp({ error: "bad address" }, 400);

    // Сообщение должно называть тот же адрес и быть свежим — защита от переигрывания чужой подписи.
    const ts = /ts:(\d+)/.exec(message)?.[1];
    if (!message.toLowerCase().includes(addr) || !ts) return jsonResp({ error: "bad message" }, 400);
    if (Math.abs(Date.now() - Number(ts)) > MAX_AGE_MS) return jsonResp({ error: "expired" }, 400);

    const ok = await verifyMessage({ address: addr as `0x${string}`, message, signature: signature as `0x${string}` });
    if (!ok) return jsonResp({ error: "invalid signature" }, 401);

    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ role: "authenticated", sub: addr, wallet: addr, iat: now, exp: now + 60 * 60 * 24 * 7 });
    return jsonResp({ token });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
