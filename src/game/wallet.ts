// Интеграция EVM-кошельков (MetaMask / Rabby / Phantom и любой другой) — без тяжёлых adapter-библиотек.
//
// Обнаружение идёт по стандарту **EIP-6963**, а не через window.ethereum. Это принципиально:
// когда у игрока стоит несколько кошельков сразу, все они пытаются занять window.ethereum, и туда
// попадает случайный — игрок жмёт «подключить Rabby», а открывается MetaMask. По EIP-6963 каждый
// кошелёк объявляет себя отдельно (со своим именем и иконкой), и мы работаем ровно с выбранным.
// Старый window.ethereum оставлен только как запасной вариант для древних кошельков.
import { CHAIN } from "./chain";

type Eip1193Handler = (arg: unknown) => void;
export type EvmProvider = {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: Eip1193Handler) => void;
  removeListener?: (event: string, handler: Eip1193Handler) => void;
};

// Как кошелёк представляется по EIP-6963. rdns — стабильный идентификатор (io.metamask и т.п.),
// именно его запоминаем: uuid у каждой вкладки свой и для запоминания не годится.
export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
type Discovered = WalletInfo & { provider: EvmProvider };

// Кошельки, которые предлагаем явно. Порядок = порядок в окне выбора.
// Если кошелёк не установлен — показываем ссылку на установку вместо кнопки подключения.
//
// color — запасной цвет значка. Настоящую иконку присылает САМ кошелёк (по EIP-6963), но только
// когда он установлен: у неустановленных иконку взять неоткуда, и без запасного варианта в списке
// зияли бы пустые квадраты. Рисуем кружок с буквой в узнаваемом цвете бренда.
export const KNOWN_WALLETS = [
  { rdns: "io.metamask", name: "MetaMask", install: "https://metamask.io/download/", color: "#f6851b" },
  { rdns: "io.rabby", name: "Rabby", install: "https://rabby.io/", color: "#7084ff" },
  { rdns: "app.phantom", name: "Phantom", install: "https://phantom.app/download", color: "#ab9ff2" },
] as const;

// Куда отправлять, если не установлено вообще ничего.
export const WALLET_INSTALL_URL = "https://metamask.io/download/";

const PICK_KEY = "duckverse.wallet"; // какой кошелёк игрок выбрал в прошлый раз

const discovered = new Map<string, Discovered>();
let selectedRdns: string | null = null;
try {
  selectedRdns = localStorage.getItem(PICK_KEY);
} catch {
  /* приватный режим — просто не запоминаем выбор */
}

// Формат события по EIP-6963: detail = { info: {uuid,name,icon,rdns}, provider }.
type AnnounceDetail = { info: WalletInfo; provider: EvmProvider };

// Кто хочет знать о новых кошельках (окно выбора перерисовывается по этому событию).
const listeners = new Set<() => void>();

// Слушаем объявления кошельков. Подписываемся сразу при загрузке модуля и НЕ отписываемся:
// кошельки объявляются не одновременно — расширение может проснуться через секунду и позже.
// Именно поэтому одного разового опроса мало: установленный кошелёк, ответивший с задержкой,
// иначе так и остался бы в списке помеченным как «не установлен».
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    const d = (e as CustomEvent<AnnounceDetail>).detail;
    if (!d?.info?.rdns || !d.provider) return;
    const known = discovered.has(d.info.rdns);
    discovered.set(d.info.rdns, { ...d.info, provider: d.provider });
    if (!known) listeners.forEach((fn) => fn()); // появился новый — обновляем окно выбора
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

// Подписаться на появление новых кошельков. Возвращает функцию отписки.
export function onWalletsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announced(): Discovered[] {
  return Array.from(discovered.values());
}

// Спросить кошельки заново и подождать ответа. Расширения отвечают синхронно, но им нужен
// один тик, поэтому ждём совсем немного.
export async function discoverWallets(waitMs = 250): Promise<WalletInfo[]> {
  if (typeof window === "undefined") return [];
  // Спрашиваем несколько раз подряд: часть расширений инициализируется с задержкой и на первый
  // запрос не отвечает. Плюс работает подписка выше — если кошелёк объявится ещё позже, окно
  // выбора обновится само.
  for (const delay of [0, waitMs, waitMs * 3]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }
  await new Promise((r) => setTimeout(r, 120));
  return announced().map(({ uuid, name, icon, rdns }) => ({ uuid, name, icon, rdns }));
}

// Установлен ли конкретный кошелёк (объявился ли он по EIP-6963).
export function isWalletInstalled(rdns: string): boolean {
  return discovered.has(rdns);
}

// Запомнить выбор игрока, чтобы при следующем заходе подключаться тем же кошельком.
export function selectWallet(rdns: string): void {
  selectedRdns = rdns;
  try {
    localStorage.setItem(PICK_KEY, rdns);
  } catch {
    /* не смогли запомнить — не критично, спросим снова */
  }
}
export function clearWalletChoice(): void {
  selectedRdns = null;
  try {
    localStorage.removeItem(PICK_KEY);
  } catch {
    /* ничего */
  }
}
export function selectedWallet(): string | null {
  return selectedRdns;
}

// Провайдер, с которым работаем. Приоритет: выбранный игроком → единственный найденный →
// старый window.ethereum (для кошельков, не умеющих EIP-6963).
export function getWallet(): EvmProvider | null {
  if (selectedRdns) {
    const picked = discovered.get(selectedRdns);
    if (picked) return picked.provider;
  }
  const all = announced();
  if (all.length === 1) return all[0].provider;
  const legacy = (window as unknown as { ethereum?: EvmProvider }).ethereum;
  return legacy ?? null;
}

// Установлен ли хоть один кошелёк.
export function hasAnyWallet(): boolean {
  return announced().length > 0 || !!(window as unknown as { ethereum?: unknown }).ethereum;
}

// Адреса EVM регистронезависимы: кошельки отдают их в «checksum»-виде (0xAbC…), но это тот же самый
// адрес, что и 0xabc…. Всё, что идёт в базу и в JWT, приводим к нижнему регистру ОДИНАКОВО на клиенте
// и на сервере — иначе один игрок, зашедший из двух мест, получит два разных аккаунта с разными
// питомцами и балансом. С base58-адресами Solana этой проблемы не было (там регистр значащий).
export function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

// Подключить кошелёк. silent=true — НЕ показывать окно подтверждения: просто спросить, есть ли уже
// выданный доступ (для тихого авто-входа при перезагрузке страницы).
// rdns — подключить конкретный кошелёк (и запомнить его как выбранный).
export async function connectWallet(opts?: { silent?: boolean; rdns?: string }): Promise<string | null> {
  if (opts?.rdns) selectWallet(opts.rdns);
  const provider = getWallet();
  if (!provider) return null;
  const method = opts?.silent ? "eth_accounts" : "eth_requestAccounts";
  const accounts = (await provider.request({ method })) as string[] | undefined;
  return accounts?.[0] ? normalizeAddress(accounts[0]) : null;
}

// Отключение. В EIP-1193 «отключиться» со стороны сайта, строго говоря, нельзя — доступом владеет
// сам кошелёк. Пробуем штатно отозвать разрешение (умеет не каждый кошелёк), а состояние в игре
// чистит вызывающий код в любом случае.
export async function disconnectWallet(): Promise<void> {
  const provider = getWallet();
  clearWalletChoice(); // в следующий раз снова показываем выбор кошелька
  if (!provider) return;
  try {
    await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    /* кошелёк не поддерживает отзыв — не страшно, локальное состояние всё равно очистится */
  }
}

// Подписка на смену аккаунта/сети. Возвращает функцию отписки.
// chainChanged важен не меньше accountsChanged: если игрок переключит сеть вручную, платежи уйдут
// не туда, поэтому UI должен об этом узнать.
export function watchWallet(handlers: { onAccount: (addr: string | null) => void; onChain: (chainId: string) => void }): () => void {
  const provider = getWallet();
  if (!provider?.on) return () => {};
  const onAccounts = (arg: unknown) => {
    const list = arg as string[];
    handlers.onAccount(list?.[0] ? normalizeAddress(list[0]) : null);
  };
  const onChain = (arg: unknown) => handlers.onChain(String(arg));
  provider.on("accountsChanged", onAccounts);
  provider.on("chainChanged", onChain);
  return () => {
    provider.removeListener?.("accountsChanged", onAccounts);
    provider.removeListener?.("chainChanged", onChain);
  };
}

// Убедиться, что кошелёк стоит именно на нашей сети; если нет — попросить переключиться.
// Кошелёк может не знать про Robinhood Chain — тогда код ошибки 4902, и мы предлагаем добавить её
// параметрами из chain.ts. У Phantom сеть встроена, так что до добавления там дело не доходит
// (добавлять произвольные сети Phantom и не умеет — но ему это и не нужно).
export async function ensureChain(): Promise<boolean> {
  const provider = getWallet();
  if (!provider) return false;
  try {
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (current?.toLowerCase() === CHAIN.hexId.toLowerCase()) return true;
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.hexId }] });
    return true;
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code !== 4902) return false; // 4902 = сеть неизвестна кошельку; остальное = игрок отказался
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN.hexId,
          chainName: CHAIN.name,
          rpcUrls: [CHAIN.rpc],
          blockExplorerUrls: [CHAIN.explorer],
          nativeCurrency: CHAIN.currency,
        }],
      });
      return true;
    } catch {
      return false;
    }
  }
}

// Подписать сообщение кошельком (EIP-191 personal_sign) → hex-подпись для auth-функции.
// Порядок параметров у personal_sign именно такой: [сообщение, адрес].
export async function signMessageHex(address: string, message: string): Promise<string> {
  const provider = getWallet();
  if (!provider) throw new Error("no wallet");
  const hex = "0x" + Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return (await provider.request({ method: "personal_sign", params: [hex, address] })) as string;
}

// Короткий вид адреса: 0xf39F…2266 (для 0x-адресов первые 4 символа съел бы сам префикс, поэтому 6).
export function shortAddress(addr: string): string {
  if (!addr) return "";
  const head = addr.startsWith("0x") ? 6 : 4;
  return addr.length > head + 5 ? `${addr.slice(0, head)}…${addr.slice(-4)}` : addr;
}
