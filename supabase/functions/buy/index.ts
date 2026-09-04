// Supabase Edge Function "buy": проверяет транзакцию оплаты в Robinhood Chain и начисляет PV.
// Клиент присылает {wallet, signature} (signature = хэш транзакции). Мы:
//  1) убеждаемся, что хэш ещё не использован (защита от повторов);
//  2) читаем транзакцию из блокчейна и проверяем, что wallet заплатил на treasury;
//  3) начисляем PV в СЕРВЕРНЫЙ баланс атомарно и запоминаем покупку.
//
// Публичный RPC сети рейт-лимитирован и для продакшена не рекомендован — если упрёмся, кладём
// платный эндпоинт в секрет RH_RPC_URL (в коде хардкодить URL с ключом НЕЛЬЗЯ: репозиторий публичный).
const RPC = Deno.env.get("RH_RPC_URL") ?? "https://rpc.mainnet.chain.robinhood.com";
// ⚙️ Казна на Robinhood Chain (0x…, нижним регистром). Нулевой адрес → оплаты отклоняются (предохранитель).
const TREASURY = "0x3b51dbd73fe5d9d95c2b228f1642e0ffaa592246";
const RATE = 180000; // 1 ETH → 180 000 PV (пересчитано с прежних 7 500 PV за SOL по цене ETH/SOL)
const WEI_PER_ETH = 1000000000000000000n;
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
// Вызвать атомарную SQL-функцию баланса. Возвращает новый баланс или null.
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
// Без авторизации + несколько RPC-вызовов на запрос → без лимита кто угодно может слать пачки
// мусорных хэшей и забивать функцию. rl_check — атомарный счётчик в базе (см. marketplace.sql),
// общий для всех инстансов функции (не in-memory).
async function rateLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/rl_check`, { method: "POST", headers: sbHeaders(), body: JSON.stringify({ p_key: key, p_max: max, p_window_ms: windowMs, p_now: Date.now() }) });
  const ok = await res.json().catch(() => true);
  return ok !== true; // rl_check вернул false → лимит исчерпан
}
// Хэш транзакции в EVM — ровно 32 байта hex. Проверяем формат ДО обращения к RPC: отсекает мусор
// бесплатно. (В Solana-версии тут была base58-проверка длиной 80–100 символов.)
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;

// Один JSON-RPC вызов к ноде сети.
async function ethCall(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json().catch(() => null);
  return j?.result ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!ADDR_RE.test(TREASURY) || /^0x0+$/.test(TREASURY)) {
      return jsonResp({ error: "treasury not configured" }, 503);
    }
    const body = await req.json();
    const signature = String(body.signature ?? "");
    // Адрес нормализуем так же, как клиент (см. normalizeAddress в wallet.ts): 0xAbC… и 0xabc… —
    // один и тот же кошелёк, и в базе он должен быть ровно одним.
    const wallet = String(body.wallet ?? "").toLowerCase();
    if (!wallet || !signature) return jsonResp({ error: "missing fields" }, 400);
    if (!TX_RE.test(signature)) return jsonResp({ error: "bad tx hash format" }, 400);
    if (!ADDR_RE.test(wallet)) return jsonResp({ error: "bad address" }, 400);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (await rateLimited(`buy:${ip}`, 15, 60000)) return jsonResp({ error: "too many requests, slow down" }, 429);

    // 1) Читаем транзакцию (с повторами — нода может ещё не видеть её сразу после отправки).
    let tx: any = null;
    for (let i = 0; i < 8; i++) {
      tx = await ethCall("eth_getTransactionByHash", [signature]);
      if (tx) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tx) return jsonResp({ error: "tx not found (try again in a few seconds)" }, 404);

    // 2) Транзакция должна быть В БЛОКЕ и успешной. В EVM попадание в блок ≠ успех: у неудачной
    //    транзакции status = 0x0, деньги при этом не переводятся — принимать такую нельзя.
    const receipt = await ethCall("eth_getTransactionReceipt", [signature]);
    if (!receipt) return jsonResp({ error: "tx not confirmed yet (try again)" }, 404);
    if (receipt.status !== "0x1") return jsonResp({ error: "tx failed on-chain" }, 400);

    // 3) Проверяем сам перевод: платил именно этот кошелёк, получила именно казна.
    if (String(tx.from ?? "").toLowerCase() !== wallet) return jsonResp({ error: "payer mismatch" }, 400);
    if (String(tx.to ?? "").toLowerCase() !== TREASURY) return jsonResp({ error: "no payment to treasury" }, 400);

    // Сумма в wei не помещается в обычное число JS (0.04 ETH = 4e16 wei — больше безопасного
    // предела 9e15), поэтому считаем bigint, а в базу пишем строкой.
    const wei = BigInt(tx.value ?? "0x0");
    if (wei <= 0n) return jsonResp({ error: "no payment to treasury" }, 400);
    const pv = Number((wei * BigInt(RATE)) / WEI_PER_ETH);
    if (!(pv > 0)) return jsonResp({ error: "payment too small" }, 400);

    // 4) Записываем покупку ПЕРВОЙ (signature — PK): при повторе будет конфликт 409 → не начисляем дважды.
    const rec = await fetch(`${SB_URL}/rest/v1/purchases`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ signature, wallet, lamports: wei.toString(), pv, created_at: new Date().toISOString() }),
    });
    if (rec.status === 409) return jsonResp({ error: "already processed" }, 409);
    if (!rec.ok) return jsonResp({ error: "record failed" }, 500);

    // 5) Начисляем PV в СЕРВЕРНЫЙ баланс АТОМАРНО (pv_add_checked: UPDATE ... SET coins=coins+pv RETURNING).
    //    Так параллельные покупки/начисления не затирают друг друга (без lost-update).
    await ensureBalanceRow(wallet);
    const coins = await rpcNum("pv_add_checked", { p_wallet: wallet, p_delta: pv, p_min: 0 });

    return jsonResp({ ok: true, credited: pv, coins: coins ?? pv });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
