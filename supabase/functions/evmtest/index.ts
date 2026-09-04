// ВРЕМЕННАЯ функция-проверка готовности (удалить после запуска — см. шаг в конце ответа).
// Открывается в браузере и одним ответом показывает, всё ли настроено для приёма и выплаты денег.
//
// БЕЗОПАСНОСТЬ: функция НИКОГДА не выводит значения секретов. Про приватный ключ казны она печатает
// только ВЫЧИСЛЕННЫЙ ИЗ НЕГО АДРЕС — адрес публичен и так лежит в открытом коде. Это позволяет
// поймать самую дорогую ошибку («вставил ключ не от того кошелька») до того, как в казну зайдут
// реальные деньги: если ключ чужой, выплаты игрокам будут уходить не с того адреса и падать.
import { generatePrivateKey, privateKeyToAccount } from "npm:viem@2.21.55/accounts";
import { verifyMessage, createPublicClient, http, formatEther } from "npm:viem@2.21.55";

const RPC = Deno.env.get("RH_RPC_URL") ?? "https://rpc.mainnet.chain.robinhood.com";
const TREASURY_SECRET = Deno.env.get("TREASURY_SECRET") ?? "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";

// Должно совпадать с TREASURY в pay.ts / buy / market-buy и ADMIN в sell-payout.
const EXPECTED_TREASURY = "0x3b51dbd73fe5d9d95c2b228f1642e0ffaa592246";
const RH_CHAIN_ID = 4663;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function jsonResp(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const out: Record<string, unknown> = {};
  const problems: string[] = [];

  try {
    // --- 1. Криптография EVM работает в edge-функции (на этом держится вход в игру) ---
    const acc = privateKeyToAccount(generatePrivateKey());
    const msg = `Sign in to Petaverse ts:${Date.now()}`;
    const sig = await acc.signMessage({ message: msg });
    const good = await verifyMessage({ address: acc.address, message: msg, signature: sig });
    const forged = await verifyMessage({ address: privateKeyToAccount(generatePrivateKey()).address, message: msg, signature: sig });
    out["1_signatures"] = good && !forged ? "OK" : "FAILED";
    if (!(good && !forged)) problems.push("signature check broken — login will not work");

    // --- 2. Секреты на месте (только факт наличия, не значения) ---
    out["2_secrets"] = {
      JWT_SECRET: JWT_SECRET ? `set (${JWT_SECRET.length} chars)` : "MISSING",
      TREASURY_SECRET: TREASURY_SECRET ? "set" : "MISSING",
      RH_RPC_URL: Deno.env.get("RH_RPC_URL") ? "set (custom RPC)" : "not set (using public RPC)",
    };
    if (!JWT_SECRET) problems.push("JWT_SECRET missing — nobody can log in");
    if (!TREASURY_SECRET) problems.push("TREASURY_SECRET missing — payouts impossible");

    // --- 3. Ключ казны действительно от НАШЕЙ казны ---
    if (TREASURY_SECRET) {
      try {
        const pk = (TREASURY_SECRET.startsWith("0x") ? TREASURY_SECRET : "0x" + TREASURY_SECRET) as `0x${string}`;
        const derived = privateKeyToAccount(pk).address.toLowerCase();
        const match = derived === EXPECTED_TREASURY.toLowerCase();
        out["3_treasury_key"] = {
          addressFromKey: derived,
          expected: EXPECTED_TREASURY,
          match: match ? "OK — key belongs to the configured treasury" : "MISMATCH",
        };
        if (!match) problems.push("TREASURY_SECRET is a key for a DIFFERENT wallet than the configured treasury");
      } catch (e) {
        out["3_treasury_key"] = { error: "could not read key — wrong format? expected 0x + 64 hex", detail: String(e) };
        problems.push("TREASURY_SECRET is not a valid EVM private key (must be 0x + 64 hex, not base58)");
      }
    }

    // --- 4. Сеть отвечает и это именно Robinhood Chain ---
    try {
      const client = createPublicClient({ transport: http(RPC) });
      const chainId = await client.getChainId();
      const balance = await client.getBalance({ address: EXPECTED_TREASURY as `0x${string}` });
      out["4_chain"] = {
        chainId,
        chainIdOk: chainId === RH_CHAIN_ID ? "OK" : `WRONG CHAIN (expected ${RH_CHAIN_ID})`,
        blockNumber: String(await client.getBlockNumber()),
        treasuryBalance: `${formatEther(balance)} ETH`,
      };
      if (chainId !== RH_CHAIN_ID) problems.push(`RPC points at chain ${chainId}, not Robinhood Chain (${RH_CHAIN_ID})`);
      if (balance === 0n) problems.push("treasury has 0 ETH — buying works, but payouts and quest rewards cannot be sent");
    } catch (e) {
      out["4_chain"] = { error: String(e) };
      problems.push("cannot reach the chain RPC");
    }

    out["VERDICT"] = problems.length === 0 ? "✅ ALL GOOD — ready to go live" : "⚠️ SEE PROBLEMS BELOW";
    out["problems"] = problems.length ? problems : "none";
    return jsonResp(out);
  } catch (e) {
    return jsonResp({ VERDICT: "❌ FAILED TO RUN", error: String(e), ...out }, 500);
  }
});
