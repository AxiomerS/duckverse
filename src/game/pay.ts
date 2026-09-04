// Реальная покупка DC за ETH на Robinhood Chain. Клиент формирует перевод ETH на казну и отправляет
// через кошелёк игрока; дальше серверная функция проверит транзакцию в блокчейне и начислит DC.
//
// Библиотеку сюда намеренно НЕ тащим: нативный перевод — это один eth_sendTransaction, а сумму
// считаем в bigint (см. ethToWei в chain.ts). Раньше тут был @solana/web3.js; после переезда
// клиенту вообще не нужна цепочечная библиотека.
import { CHAIN, ethToWei } from "./chain";
import { getWallet, ensureChain, normalizeAddress } from "./wallet";

// ⚙️ Кошелёк-казна (куда идут оплаты). ВНИМАНИЕ: у EVM адрес в формате 0x…, не base58 —
// старый solana-адрес казны сюда не подходит, нужен новый кошелёк на Robinhood Chain.
// Нулевой адрес — это адрес СЖИГАНИЯ: отправленное туда пропадает навсегда. Поэтому ниже стоит
// проверка, которая не даёт отправить платёж, если адрес вдруг окажется незаполненным.
export const TREASURY = "0x3b51dbd73fe5d9d95c2b228f1642e0ffaa592246";

// Настроена ли казна. Отдельная проверка, потому что молча отправить деньги в нулевой адрес —
// худший возможный баг в этом файле: игрок платит, деньги исчезают, вернуть их нельзя.
export function isTreasuryConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(TREASURY) && !/^0x0+$/.test(TREASURY);
}

// ⚙️ КУРСЫ. Пересчитаны с прежних SOL-курсов по соотношению цен ETH/SOL (~23×) — так, чтобы
// стоимость в долларах осталась прежней, а не выросла в 23 раза от простой замены тикера.
// Прежние значения: 7 500 DC за 1 SOL (покупка), 10 000 DC за 1 SOL (продажа), пакеты 0.05–1 SOL.
export const ETH_PV_RATE = 180000; // покупка: 1 ETH → 180 000 DC
export const ETH_SELL_RATE = 240000; // продажа: 240 000 DC → 1 ETH (спред 1.33 — как и был)
export const ETH_SELL_PACKS = [5000, 10000, 25000, 50000]; // варианты продажи в DC (в $ — как раньше)
export const ETH_BUY_PACKS = [0.002, 0.004, 0.02, 0.04]; // варианты покупки в ETH (≈ $5 / $10 / $50 / $99)
export const MARKET_FEE_BPS = 500; // комиссия казны с продажи пета между игроками (5%) — синхронно с edge market-buy

// Дождаться, пока транзакция попадёт в блок, и убедиться, что она не зафейлилась.
// В EVM «отправлено» ≠ «прошло»: транзакция может быть включена в блок со статусом 0x0 (reverted),
// и деньги при этом не переведутся — поэтому статус проверяем явно, а не считаем факт хэша успехом.
async function waitForReceipt(hash: string, timeoutMs = 90000): Promise<boolean> {
  const provider = getWallet();
  if (!provider) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt) return receipt.status === "0x1";
    await new Promise((r) => setTimeout(r, 1500)); // блоки тут ~100мс, но подтверждение через кошелёк идёт медленнее
  }
  return false; // не дождались — вызывающий код положит платёж в pending и до-подтвердит позже
}

// Отправить ETH на казну. Возвращает хэш + адрес плательщика (тот аккаунт, который РЕАЛЬНО подписал,
// а не тот, что был выбран в UI на момент клика), либо null.
// Возвращать именно этот адрес важно: если игрок переключит аккаунт в кошельке между кликом и
// подтверждением, wallet в состоянии React уже не совпадёт с плательщиком — сверка на сервере
// провалится, и оплаченный ETH зависнет без начисления.
export async function sendPayment(eth: number): Promise<{ signature: string; payer: string } | null> {
  const provider = getWallet();
  if (!provider) return null;
  if (!isTreasuryConfigured()) return null; // казна ещё не настроена — лучше не заплатить, чем сжечь
  if (!(await ensureChain())) return null; // игрок не на Robinhood Chain и отказался переключаться

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
  const payer = accounts?.[0] ? normalizeAddress(accounts[0]) : null;
  if (!payer) return null;

  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: payer, to: TREASURY, value: "0x" + ethToWei(eth).toString(16) }],
  })) as string;

  await waitForReceipt(hash);
  return { signature: hash, payer };
}

// Оставлено для читаемости UI: адрес сети, на которой всё происходит.
export const CHAIN_NAME = CHAIN.name;
