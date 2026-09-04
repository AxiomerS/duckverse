// Облачные сейвы через Supabase (прямые запросы к REST — без тяжёлых библиотек).
// Прогресс питомца хранится по адресу кошелька: таблица public.saves (wallet, data, updated_at).
// Если переменные окружения не заданы — облако выключено, игра работает чисто локально.
import { type SavedPet } from "./save";
import { type BuffKind } from "./buffs";

const RAW_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
// Базовый адрес проекта без лишнего хвоста: убираем завершающие слэши и случайный /rest/v1.
const URL = RAW_URL ? RAW_URL.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "") : undefined;

// Настроено ли облако (заданы ли URL и ключ).
export function isCloudEnabled(): boolean {
  return !!(URL && KEY);
}

// Токен сессии (JWT из auth-функции). Пока его нет — работаем анонимным ключом.
let sessionToken: string | null = null;
export function setSessionToken(t: string | null) { sessionToken = t; }
export function isVerified(): boolean { return !!sessionToken; }

function headers(extra?: Record<string, string>): Record<string, string> {
  return { apikey: KEY!, Authorization: `Bearer ${sessionToken ?? KEY!}`, "Content-Type": "application/json", ...extra };
}

// Подтвердить покупку DC: серверная функция проверит транзакцию в блокчейне и начислит DC.
// notFound (404/сеть) = tx ещё не видна → повторить позже; already (409) = уже зачислено.
export async function confirmPurchase(wallet: string, signature: string): Promise<{ coins: number; credited: number } | { error: string; notFound?: boolean; already?: boolean }> {
  if (!isCloudEnabled()) return { error: "cloud off" };
  try {
    const res = await fetch(`${URL}/functions/v1/buy`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ wallet, signature }),
    });
    const data = (await res.json().catch(() => ({}))) as { coins?: number; credited?: number; error?: string };
    if (res.ok && typeof data.coins === "number") return { coins: data.coins, credited: data.credited ?? 0 };
    return { error: data.error ?? `HTTP ${res.status}`, notFound: res.status === 404, already: res.status === 409 };
  } catch (e) {
    return { error: String(e), notFound: true }; // сетевой сбой → тоже повторяемо
  }
}

// Запрос на продажу DC → SOL: сервер списывает DC и создаёт заявку (pending). Выплата — после
// ручного подтверждения. Возвращает новый баланс coins и сумму SOL, либо ошибку.
export async function requestSell(pv: number): Promise<{ coins: number; sol: number } | { error: string }> {
  if (!isCloudEnabled()) return { error: "cloud off" };
  try {
    const res = await fetch(`${URL}/functions/v1/sell`, { method: "POST", headers: headers(), body: JSON.stringify({ pv }) });
    const data = (await res.json().catch(() => ({}))) as { coins?: number; sol?: number; error?: string };
    if (res.ok && typeof data.coins === "number") return { coins: data.coins, sol: data.sol ?? 0 };
    return { error: data.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { error: String(e) };
  }
}

// Заявка на продажу (для админ-панели).
export type SellRequest = { id: string; wallet: string; pv: number; sol: number; status: string; sig?: string; kind?: string; created_at?: string };

// Список заявок по статусу (видит свои — обычный игрок; все — админ, по RLS-политике).
export async function fetchSellRequests(status = "pending"): Promise<SellRequest[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/sell_requests?status=eq.${status}&select=*&order=created_at.asc`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as SellRequest[];
  } catch {
    return null;
  }
}

// Застрявшие заявки (сбой выплаты: status error/paying) — для админа, чтобы разобрать/повторить.
export async function fetchStuckSellRequests(): Promise<SellRequest[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/sell_requests?status=in.(error,paying)&select=*&order=created_at.asc`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as SellRequest[];
  } catch {
    return null;
  }
}

// Подтвердить (approve → выплата SOL с казны), отклонить (reject → возврат DC для kind='sell') или
// вернуть застрявшую заявку в очередь (reset → error/paying обратно в pending). Только админ.
export async function payoutSell(id: string, action: "approve" | "reject" | "reset"): Promise<{ ok: true; status: string; sig?: string } | { error: string }> {
  if (!isCloudEnabled()) return { error: "cloud off" };
  try {
    const res = await fetch(`${URL}/functions/v1/sell-payout`, { method: "POST", headers: headers(), body: JSON.stringify({ id, action }) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; sig?: string; error?: string };
    if (res.ok && data.ok) return { ok: true, status: data.status ?? "", sig: data.sig };
    return { error: data.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { error: String(e) };
  }
}

// Верификация кошелька: шлём подпись в Edge Function, получаем JWT. Возвращает токен или null.
export async function signIn(wallet: string, message: string, signatureHex: string): Promise<string | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/functions/v1/auth`, {
      method: "POST",
      headers: { apikey: KEY!, Authorization: `Bearer ${KEY!}`, "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, message, signature: signatureHex }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    if (!data.token) return null;
    setSessionToken(data.token);
    return data.token;
  } catch {
    return null;
  }
}

// Загрузить сейв по адресу кошелька. null — если записи нет или облако выключено/ошибка.
export async function loadCloudSave(wallet: string): Promise<SavedPet | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: headers() });
    if (!res.ok) return null;
    const rows = (await res.json()) as { data: SavedPet }[];
    return rows[0]?.data ?? null;
  } catch {
    return null;
  }
}

// Сохранить (upsert) сейв по адресу кошелька. true — если успешно.
export async function saveCloudSave(wallet: string, data: SavedPet): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/saves`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ wallet, data, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ===== Глобальный лидерборд (таблица public.scores) =====
export type ScoreRow = { wallet: string; name: string; score: number };

// Отправить лучший счёт игрока (upsert по адресу). Счёт монотонно растёт → просто перезаписываем.
export async function submitScore(wallet: string, name: string, score: number): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/scores`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ wallet, name, score, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Топ игроков по счёту. null — если облако выключено/ошибка (например, таблицы ещё нет).
export async function fetchTopScores(limit = 20): Promise<ScoreRow[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/scores?select=wallet,name,score&order=score.desc&limit=${limit}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as ScoreRow[];
  } catch {
    return null;
  }
}

// ===== Рейтинг арены (таблица public.arena) =====
export type ArenaRow = { wallet: string; name: string; species: string; power: number; wins: number; losses: number };

// Отправить статистику арены игрока (upsert по адресу).
export async function submitArena(row: ArenaRow): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/arena`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Топ бойцов: сначала по победам, затем по силе. null — если облако выключено/ошибка.
export async function fetchTopArena(limit = 20): Promise<ArenaRow[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/arena?select=wallet,name,species,power,wins,losses&order=wins.desc,power.desc&limit=${limit}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as ArenaRow[];
  } catch {
    return null;
  }
}

// ===== Онлайн PvP (таблица public.pvp) — профиль бойца для матчмейкинга =====
export type PvpProfile = { wallet: string; name: string; species: string; level: number; accessories: string[] };

// Обновить свой боевой профиль (вид, уровень, снаряжение) — чтобы другие могли на тебя матчиться.
export async function upsertPvpProfile(p: PvpProfile): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/pvp`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ ...p, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Найти случайного онлайн-соперника (не себя). null — если облако выключено/нет соперников.
// ВАЖНО: это СНИМОК чужого профиля на момент запроса — сам игрок про бой не узнаёт (async-бой,
// не live). Для live-матча см. battleQueuePoll/battleQueueLeave ниже.
export async function findPvpOpponent(myWallet: string): Promise<PvpProfile | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/pvp?wallet=neq.${encodeURIComponent(myWallet)}&select=wallet,name,species,level,accessories&order=updated_at.desc&limit=25`, { headers: headers() });
    if (!res.ok) return null;
    const rows = (await res.json()) as PvpProfile[];
    if (!rows.length) return null;
    return rows[Math.floor(Math.random() * rows.length)];
  } catch {
    return null;
  }
}

// ===== LIVE PvP-матчмейкинг (edge fn "battle-live", таблица public.battle_queue) =====
export type BattleQueueResult = { status: "waiting" | "matched"; matchId: string | null; opponent: PvpProfile | null };

// Один "тик" очереди: встать/остаться в очереди + попытаться забрать пару. Вызывать раз в 1.5-2с,
// пока идёт поиск. null — облако выключено/ошибка сети (клиент должен трактовать как "ещё жду").
export async function battleQueuePoll(fighter: { name: string; species: string; level: number; accessories: string[]; bet: number }): Promise<BattleQueueResult | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/functions/v1/battle-live`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: "poll", name: fighter.name, species: fighter.species, level: fighter.level, accessories: fighter.accessories, bet: fighter.bet }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { status: d.status, matchId: d.matchId ?? null, opponent: d.opponent ?? null };
  } catch {
    return null;
  }
}

// Выйти из очереди (отмена поиска / истёк дедлайн на клиенте — переходим на async/bot).
export async function battleQueueLeave(): Promise<void> {
  if (!isCloudEnabled()) return;
  try {
    await fetch(`${URL}/functions/v1/battle-live`, { method: "POST", headers: headers(), body: JSON.stringify({ action: "leave" }) });
  } catch {
    // не критично — строка сама не заблокирует никого (в пару берут только status='waiting')
  }
}

// Убрать обе стороны матча из очереди после того как бой отыгран.
export async function battleQueueFinish(matchId: string): Promise<void> {
  if (!isCloudEnabled()) return;
  try {
    await fetch(`${URL}/functions/v1/battle-live`, { method: "POST", headers: headers(), body: JSON.stringify({ action: "finish", matchId }) });
  } catch {
    // не критично — см. battle_queue_finish в SQL
  }
}

// ===== Живой рынок (таблица public.listings) — общие лоты питомцев =====
export type Listing = {
  id: string;
  seller: string;
  kind: "sale" | "auction";
  species: string;
  level: number;
  buffs: { kind: BuffKind; expiresAt: number }[];
  accessories?: string[]; // аксессуары, надетые на выставленного пета (переходят покупателю)
  price: number;
  name?: string;
  created_at?: string;
};

// Все лоты выбранного типа (продажа/аукцион), новые сверху. null — облако выключено/ошибка.
export async function fetchListings(kind: "sale" | "auction", limit = 100): Promise<Listing[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/listings?kind=eq.${kind}&select=*&order=created_at.desc&limit=${limit}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as Listing[];
  } catch {
    return null;
  }
}

// Выставить лот.
export async function createListing(l: Listing): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/listings`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(l),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Снять свой лот (только свой — по id и адресу продавца).
// Возвращает удалённые строки: пустой массив = лот уже продан/снят (нечего возвращать), null = ошибка.
export async function deleteListing(id: string, seller: string): Promise<Listing[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&seller=eq.${encodeURIComponent(seller)}`, {
      method: "DELETE",
      headers: headers({ Prefer: "return=representation" }),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => [])) as Listing[];
  } catch {
    return null;
  }
}

// ===== Покупка на маркете (реальный SOL) — серверная функция проверяет tx и проводит сделку =====
// type 'sale' — купить лот игрока (refId = listing.id); 'exclusive' — купить эксклюзив (refId = exclusive.id).
// Возвращает обновлённый сейв покупателя (для setPet) или ошибку.
export async function confirmMarketBuy(type: "sale" | "exclusive", refId: string, signature: string, wallet: string): Promise<{ save: SavedPet } | { error: string; notFound?: boolean; refund?: boolean }> {
  if (!isCloudEnabled()) return { error: "cloud off" };
  try {
    const res = await fetch(`${URL}/functions/v1/market-buy`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ wallet, signature, type, refId }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; save?: SavedPet; error?: string; refund?: boolean };
    if (res.ok && data.ok && data.save) return { save: data.save };
    // 404 = tx ещё не видна → повторить; иначе сделка завершена (уже обработано / оформлен возврат).
    return { error: data.error ?? `HTTP ${res.status}`, notFound: res.status === 404, refund: !!data.refund };
  } catch (e) {
    return { error: String(e), notFound: true }; // сетевой сбой → повторяемо
  }
}

// ===== Эксклюзивные лоты (таблица public.exclusives) — продаёт казна лимитированным тиражом =====
export type Exclusive = { id: string; species: string; name?: string; price: number; stock: number; sold?: number; active?: boolean; created_at?: string };

// Активные эксклюзивы, новые сверху. null — облако выключено/ошибка.
export async function fetchExclusives(limit = 50): Promise<Exclusive[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/exclusives?active=eq.true&select=*&order=created_at.desc&limit=${limit}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as Exclusive[];
  } catch {
    return null;
  }
}

// Добавить эксклюзив (только админ — RLS пропустит запись лишь для админского wallet-claim в JWT).
export async function createExclusive(e: Exclusive): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/exclusives`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ ...e, created_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Убрать эксклюзив с витрины (только админ).
export async function deleteExclusive(id: string): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/exclusives?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}

// ===== Серверный баланс DC (edge fn "pv") — единственный источник правды по DC =====
// Все начисления/траты идут сюда; ответ содержит авторитетный coins, которым обновляем зеркало на клиенте.
// Ответ edge-функции. Форму ожидаемых полей задаёт вызывающая обёртка через T; поверх неё всегда
// возможны error и coins — их шлёт и путь ошибки. Поля необязательные: сервер мог ответить чем угодно,
// и обёртки ниже это проверяют, а не верят на слово.
type EdgeReply<T> = Partial<T> & { error?: string; coins?: number };

async function pvCall<T>(action: string, extra: Record<string, unknown> = {}): Promise<EdgeReply<T>> {
  // Путь ошибки не несёт полей T, но доказать это дженерику TS не может — отсюда приведение.
  const fail = (error: string, coins?: number) => ({ error, coins }) as EdgeReply<T>;
  if (!isCloudEnabled()) return fail("cloud off");
  try {
    const res = await fetch(`${URL}/functions/v1/pv`, { method: "POST", headers: headers(), body: JSON.stringify({ action, ...extra }) });
    const data = (await res.json().catch(() => ({}))) as EdgeReply<T>;
    if (!res.ok) return fail(data.error ?? `HTTP ${res.status}`, data.coins);
    return data;
  } catch (e) {
    return fail(String(e));
  }
}

// Ответ без баланса там, где он обязан быть, — это сломанный ответ, а не нулевой счёт.
const BAD_REPLY = "bad server reply";
// Синхронизация: начислить пассив и вернуть авторитетный баланс. null — облако/кошелёк недоступны.
export async function pvSync(level: number): Promise<{ coins: number; lastDaily: number } | null> {
  const d = await pvCall<{ coins: number; lastDaily: number }>("sync", { level });
  return typeof d.coins === "number" ? { coins: d.coins, lastDaily: d.lastDaily ?? 0 } : null;
}
// Забрать дейли. Возвращает новый баланс или ошибку.
export async function pvDaily(): Promise<{ coins: number; credited: number } | { error: string; coins?: number }> {
  const d = await pvCall<{ coins: number; credited: number }>("daily");
  if (d.error) return { error: d.error, coins: d.coins };
  if (typeof d.coins !== "number") return { error: BAD_REPLY };
  return { coins: d.coins, credited: d.credited ?? 0 };
}
// Списать DC за покупку (магазин/сундук/разведение/воскрешение/зелье). Проверка баланса — на сервере.
export async function pvSpend(amount: number): Promise<{ coins: number } | { error: string; coins?: number }> {
  const d = await pvCall<{ coins: number }>("spend", { amount });
  if (d.error) return { error: d.error, coins: d.coins };
  if (typeof d.coins !== "number") return { error: BAD_REPLY };
  return { coins: d.coins };
}
// Рулетка: сервер списывает ставку, крутит RNG, начисляет выигрыш. Возвращает исход для анимации.
export async function pvRoulette(stake: number, bet: "red" | "black" | "zero"): Promise<{ coins: number; win: boolean; n: number; color: string } | { error: string; coins?: number }> {
  const d = await pvCall<{ coins: number; win: boolean; n: number; color: string }>("roulette", { stake, bet });
  if (d.error) return { error: d.error, coins: d.coins };
  if (typeof d.coins !== "number" || typeof d.n !== "number" || typeof d.color !== "string") return { error: BAD_REPLY };
  return { coins: d.coins, win: !!d.win, n: d.n, color: d.color };
}
// Итог боя арены: сервер меняет баланс (ставка + капнутая награда). won доверяем (Phase 1).
export async function pvBattle(stake: number, won: boolean, level: number): Promise<{ coins: number; locked?: boolean } | { error: string; coins?: number }> {
  const d = await pvCall<{ coins: number; locked: boolean }>("battle", { stake, won, level });
  if (d.error) return { error: d.error, coins: d.coins };
  if (typeof d.coins !== "number") return { error: BAD_REPLY };
  return { coins: d.coins, locked: !!d.locked };
}
// Награда за топ лидерборда (по рангу, с серверным кулдауном).
export async function pvRunReward(rank: number): Promise<{ coins: number; credited: number } | { error: string; coins?: number }> {
  const d = await pvCall<{ coins: number; credited: number }>("run-reward", { rank });
  if (d.error) return { error: d.error, coins: d.coins };
  if (typeof d.coins !== "number") return { error: BAD_REPLY };
  return { coins: d.coins, credited: d.credited ?? 0 };
}

// ===== Серверное владение питомцами (edge fn "pets" + таблица public.pet_ledger, Phase 2) =====
// pet_ledger — единственный источник правды по владению. Клиент читает свою строку (RLS read-own);
// выдача/продажа идут через edge fn (сервер проверяет и пишет service_role). save.ownedSpecies — зеркало.
export type LedgerPet = { species: string; level: number; buffs: { kind: BuffKind; expiresAt: number }[]; name?: string | null };

// Прочитать своих питомцев из леджера (авторитетный список владения). null — облако/кошелёк недоступны.
export async function petsSync(): Promise<LedgerPet[] | null> {
  if (!isCloudEnabled() || !sessionToken) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/pet_ledger?select=species,level,buffs,name`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as LedgerPet[];
  } catch {
    return null;
  }
}

async function petsCall<T>(action: string, extra: Record<string, unknown> = {}): Promise<EdgeReply<T>> {
  const fail = (error: string, coins?: number) => ({ error, coins }) as EdgeReply<T>;
  if (!isCloudEnabled()) return fail("cloud off");
  try {
    const res = await fetch(`${URL}/functions/v1/pets`, { method: "POST", headers: headers(), body: JSON.stringify({ action, ...extra }) });
    const data = (await res.json().catch(() => ({}))) as EdgeReply<T>;
    if (!res.ok) return fail(data.error ?? `HTTP ${res.status}`, data.coins);
    return data;
  } catch (e) {
    return fail(String(e));
  }
}
// Выдать стартового (бесплатного) питомца в леджер при создании аккаунта.
export async function petsStarter(species: string, name: string): Promise<boolean> {
  const d = await petsCall<Record<string, never>>("starter", { species, name });
  return !d.error;
}
// Открыть сундук питомца: сервер решает вид, списывает DC, выдаёт в леджер. active — активный вид (для скидки).
export async function petsChest(chestId: string, active: string): Promise<{ coins: number; species: string; rarity: string } | { error: string; coins?: number }> {
  const d = await petsCall<{ coins: number; species: string; rarity: string }>("chest", { chestId, active });
  if (d.error) return { error: d.error, coins: d.coins };
  if (typeof d.coins !== "number" || !d.species || !d.rarity) return { error: BAD_REPLY };
  return { coins: d.coins, species: d.species, rarity: d.rarity };
}
// Скрестить двух своих питомцев (проверка родителей — на сервере по леджеру).
export async function petsBreed(parents: string[]): Promise<{ coins: number; species: string; rarity: string } | { error: string; coins?: number }> {
  const d = await petsCall<{ coins: number; species: string; rarity: string }>("breed", { parents });
  if (d.error) return { error: d.error, coins: d.coins };
  if (typeof d.coins !== "number" || !d.species || !d.rarity) return { error: BAD_REPLY };
  return { coins: d.coins, species: d.species, rarity: d.rarity };
}
// Выставить пета на продажу: сервер забирает его из леджера (эскроу) и создаёт лот. accessories — надетые
// на пета аксессуары (уходят покупателю). Возвращает лот или ошибку.
export async function petsList(species: string, price: number, level: number, buffs: unknown, name: string, accessories: string[]): Promise<{ listing: Listing } | { error: string }> {
  const d = await petsCall<{ listing: Listing }>("list", { species, price, level, buffs, name, accessories });
  if (d.error) return { error: d.error };
  if (!d.listing) return { error: BAD_REPLY };
  return { listing: d.listing };
}
// Снять свой лот: сервер удаляет лот и возвращает пета (с аксессуарами) в леджер. restored=false → лот уже куплен.
export async function petsCancel(id: string): Promise<{ restored: boolean; species?: string; level?: number; buffs?: { kind: BuffKind; expiresAt: number }[]; accessories?: string[]; name?: string | null } | { error: string }> {
  const d = await petsCall<{ restored: boolean; species: string; level: number; buffs: { kind: BuffKind; expiresAt: number }[]; accessories: string[]; name: string | null }>("cancel", { id });
  if (d.error) return { error: d.error };
  return { restored: !!d.restored, species: d.species, level: d.level, buffs: d.buffs, accessories: d.accessories, name: d.name };
}

// ===== Заявки на награды за квесты (таблица public.quest_claims) — выплата SOL вручную админом =====
// Сумму НЕ храним в строке (клиенту не доверяем) — админ берёт её из QUESTS по quest_id.
export type QuestClaim = { id: string; wallet: string; quest_id: string; status: string; created_at?: string };

// Игрок запрашивает награду за выполненный квест. Квест теперь ГЛОБАЛЬНЫЙ (unique на quest_id
// в БД, см. marketplace.sql §8) — побеждает первый claim, остальные получают 409.
// "claimed" = награда закреплена за ЭТИМ кошельком (либо только что, либо повторный клик тем же
// игроком); "taken" = 409 и claim принадлежит ДРУГОМУ кошельку — квест уже закрыт кем-то другим.
export async function createQuestClaim(wallet: string, questId: string): Promise<"claimed" | "taken" | "error"> {
  if (!isCloudEnabled()) return "error";
  try {
    const res = await fetch(`${URL}/rest/v1/quest_claims`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ id: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`, wallet, quest_id: questId, status: "pending", created_at: new Date().toISOString() }),
    });
    if (res.ok) return "claimed";
    if (res.status !== 409) return "error";
    const check = await fetch(`${URL}/rest/v1/quest_claims?quest_id=eq.${encodeURIComponent(questId)}&select=wallet`, { headers: headers() });
    if (check.ok) {
      const rows = (await check.json()) as { wallet: string }[];
      if (rows[0]?.wallet === wallet) return "claimed";
    }
    return "taken";
  } catch {
    return "error";
  }
}

// Карта quest_id → кошелёк, который его закрыл (для ВСЕХ квестов, любой статус) — нужна каждому
// игроку, чтобы видеть закрытые кем-то другим квесты, не только свои собственные заявки.
export async function fetchClaimedQuestIds(): Promise<Record<string, string> | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/quest_claims?select=quest_id,wallet`, { headers: headers() });
    if (!res.ok) return null;
    const rows = (await res.json()) as { quest_id: string; wallet: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.quest_id] = r.wallet;
    return map;
  } catch {
    return null;
  }
}

// Все заявки на награды по статусу (админ видит все — по RLS-политике). null — облако выключено/ошибка.
export async function fetchQuestClaims(status = "pending"): Promise<QuestClaim[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/quest_claims?status=eq.${status}&select=*&order=created_at.asc`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as QuestClaim[];
  } catch {
    return null;
  }
}

// Отметить заявку выплаченной (только админ). SOL админ отправляет вручную из своего кошелька.
export async function markQuestClaimPaid(id: string): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/quest_claims?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "paid" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
