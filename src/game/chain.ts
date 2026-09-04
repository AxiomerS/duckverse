// Конфиг сети — Robinhood Chain (Arbitrum Orbit L2, сеттлится в Ethereum).
// Здесь ВСЁ, что зависит от конкретного чейна, в одном месте: если когда-нибудь понадобится
// переехать ещё раз, правится только этот файл + курсы в pay.ts.
//
// Важно: своего токена у сети НЕТ — и газ, и платежи идут в ETH.
export const CHAIN = {
  id: 4663,
  hexId: "0x1237", // 4663 в hex — кошельки (wallet_switchEthereumChain) хотят именно hex
  name: "Robinhood Chain",
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

// Тикер валюты для UI — вынесен отдельно, чтобы в интерфейсе нигде не было хардкода "SOL"/"ETH".
export const COIN = CHAIN.currency.symbol;

export const WEI_PER_ETH = 1_000_000_000_000_000_000n; // 1e18

// ETH (дробное число из UI) → wei. Через строку, а НЕ через умножение float на 1e18:
// 0.1 * 1e18 в double даёт 100000000000000000**0****something** — на деньгах такое недопустимо.
export function ethToWei(eth: number): bigint {
  const [int, frac = ""] = eth.toFixed(18).split(".");
  return BigInt(int) * WEI_PER_ETH + BigInt(frac.padEnd(18, "0"));
}

// wei → ETH числом (для показа; для расчётов денег держим bigint).
export function weiToEth(wei: bigint): number {
  return Number(wei) / 1e18;
}

// Ссылка на транзакцию в обозревателе — показываем игроку после оплаты.
export function txUrl(hash: string): string {
  return `${CHAIN.explorer}/tx/${hash}`;
}
