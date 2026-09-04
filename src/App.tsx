import { useState, useEffect, useRef } from "react";
import "./App.css";
import { RARITY, rollRarity, XP_BY_RARITY, type Rarity } from "./game/rarity";
import { PETS, STARTER_PETS, SPECIES_PERK, speciesEffect, isBasePet, type PetId } from "./game/pets";
import { FOODS, rollFood, foodTitle, FOOD_BUFF, FOOD_POWER, type Food } from "./game/foods";
import { loadoutPower, activePowerBuff, accPower, accHp, accCrit } from "./game/power";
import { ACCESSORIES, accById, SLOTS, STARTER_ACCESSORIES, equippedBonuses, accDesc, mythicAcc } from "./game/accessories";
import { BUFFS, type BuffKind } from "./game/buffs";
import { FOOD_CHESTS, ACC_CHESTS, PET_CHESTS, bestTier, fmtChance, type PoolItem } from "./game/chests";
import { type Stats, clamp, xpForLevel, decay, decayMult, decayInactive, levelSilMult, BASE_SIL_PER_MIN, statCap, DAILY_REWARD, DAILY_COOLDOWN, START_COINS, GRANT_V } from "./game/mechanics";
import { POTIONS, potionById, potionEffects, potionTitle, type Potion } from "./game/potions";
import { QUESTS } from "./game/quests";
import { type SavedPet, STORAGE_KEY, loadPet, hydrateSave, type MarketListing } from "./game/save";
// Импорты кошелька под псевдонимами: ниже в компоненте есть свои connectWallet/disconnectWallet,
// которые оборачивают эти низкоуровневые вызовы игровой логикой (тосты, автоверификация, сейв).
import { getWallet, connectWallet as walletConnect, disconnectWallet as walletDisconnect, watchWallet, discoverWallets, onWalletsChanged, selectedWallet, shortAddress, signMessageHex, KNOWN_WALLETS, type WalletInfo } from "./game/wallet";
import { isCloudEnabled, loadCloudSave, saveCloudSave, submitScore, fetchTopScores, submitArena, fetchTopArena, upsertPvpProfile, findPvpOpponent, battleQueuePoll, battleQueueLeave, battleQueueFinish, fetchListings, confirmMarketBuy, fetchExclusives, createExclusive, deleteExclusive, createQuestClaim, fetchQuestClaims, fetchClaimedQuestIds, markQuestClaimPaid, pvSync, pvDaily, pvSpend, pvRoulette, pvBattle, pvRunReward, isVerified, signIn, setSessionToken, confirmPurchase, requestSell, fetchSellRequests, fetchStuckSellRequests, payoutSell, petsSync, petsStarter, petsChest, petsBreed, petsList, petsCancel, type ScoreRow, type ArenaRow, type Listing, type Exclusive, type SellRequest, type QuestClaim, type LedgerPet } from "./game/cloud";
import { sendPayment, isTreasuryConfigured, ETH_PV_RATE, ETH_BUY_PACKS, ETH_SELL_RATE, ETH_SELL_PACKS, MARKET_FEE_BPS } from "./game/pay";
import { COIN, CHAIN } from "./game/chain";
import { SPIN_MS, playSpinSound, playWinSound, playDailySound, playModalSound, playLowStatSound } from "./game/audio";
import { playQwak } from "./game/qwak";
import { Coin, StatBar } from "./components/ui";
import { PetArt } from "./components/PetArt";
import { Roulette } from "./components/Roulette";
import { RhythmGame } from "./components/RhythmGame";
import { BattleGame } from "./components/BattleGame";

// Игровая валюта: DC (внутриигровая валюта и крипто-токен $DC).
const SIL = "DC";

// Виды с недавно добавленным оригинальным артом — подсвечиваем бейджем "New" в списке питомцев.
const NEW_SPECIES = new Set(["tiger", "dino"]);

// Иконка предмета в барабане/подписи выигрыша. Обычные предметы — эмодзи,
// утки приходят маркером "pet:<id>" и рисуются своим артом.
function ReelIcon({ v, size = 46 }: { v: string; size?: number }) {
  if (v.startsWith("pet:")) return <PetArt species={v.slice(4)} size={size} />;
  return <>{v}</>;
}

// Соперники в лидерборде — лучшие забеги в ритм-игре (локальные/фейковые;
// для настоящего глобального борда «от игроков» нужен бэкенд — следующий большой шаг).
const LEADERBOARD_BOTS = [
  { name: "RhythmKing", score: 18420 },
  { name: "DragonLord", score: 15240 },
  { name: "feese_whale", score: 12980 },
  { name: "MoonPup", score: 10120 },
  { name: "PixelFox", score: 8270 },
  { name: "SolHamster", score: 6150 },
  { name: "TinyDino", score: 4300 },
  { name: "LuckyFrog", score: 2710 },
  { name: "NoobPenguin", score: 1180 },
  { name: "Starter123", score: 540 },
];

// Почасовая награда за топ-забег по рангу в лидерборде.
const RUN_REWARD_COOLDOWN = 3_600_000; // 1 час
function runRewardForRank(rank: number): number {
  if (rank <= 3) return 500;
  if (rank <= 8) return 200;
  if (rank <= 10) return 100;
  return 50; // ниже топ-10 (если счёт совсем мал) — небольшой утешительный приз
}

type Modal = null | "shop" | "inventory" | "accessories" | "pets" | "leaderboard" | "roulette" | "play" | "breed" | "buysil" | "market" | "playmenu" | "pumpfun" | "battle" | "potions" | "admin" | "wallets";

// Кошелёк-админ: только он видит и подтверждает заявки на продажу DC.
// ⚙️ Кошелёк админа на Robinhood Chain (0x…, НИЖНИМ регистром — адреса везде нормализуются, см.
// normalizeAddress в wallet.ts). Держать в синхроне с ADMIN в edge fn sell-payout и с адресом в
// RLS-политиках (marketplace.sql §10). Нулевой адрес → админ-панель не откроется никому (предохранитель).
const ADMIN_WALLET = "0x69c159cdf7d5264f380c69f68847f806d84ef080";

// Внешние ссылки проекта (TODO: заменить на финальные).
const LINK_TWITTER = "https://x.com/PetaVerse_rh";
const LINK_LAUNCHPAD = "https://www.ponsfamily.com/launchpad";
// Контракт $DC. ПУСТО, пока токен не запущен — здесь раньше стоял адрес $PV (PetaVerse) из
// родительского проекта: это ДРУГОЙ токен, и показывать его как $DC нельзя. Вписывать адрес
// только после реального деплоя пары DC/NVDA-RWA на Robinhood Chain.
const TOKEN_CA: string = "";
// Редкость вида питомца по его id — для боевых характеристик в Battle Arena (loadoutPower).
const speciesRarity = (species: string): Rarity => PETS.find((p) => p.id === species)?.rarity ?? "common";

// Реальная покупка DC за ETH — курс и пакеты заданы в game/pay.ts (mainnet).

// Сессия верификации кошелька (JWT из auth-функции), хранится локально для бесшовного входа.
const SESSION_KEY = "duckverse.session";
function jwtExpMs(token: string): number {
  try { return (JSON.parse(atob(token.split(".")[1])).exp ?? 0) * 1000; } catch { return 0; }
}

// Незавершённые оплаты: подпись сохраняется СРАЗУ после платежа, до подтверждения. Если сеть ещё не
// видит транзакцию (частый кейс на mainnet при загрузке), подтверждение повторяется — в сессии и при
// следующем заходе. Всё идемпотентно (подпись — PK), поэтому деньги не теряются и не зачисляются дважды.
const PENDING_KEY = "duckverse.pending";
// wallet = реальный плательщик (адрес, вернувшийся из sendPayment) — НЕ читаем текущее состояние
// "wallet" при сверке: если пользователь переключит аккаунт в your wallet между оплатой и подтверждением,
// state успеет измениться, а платёж был отправлен со старого адреса — сверка на сервере должна идти
// именно по нему, иначе оплаченный ETH зависнет без начисления.
type Pending = { kind: "pv" | "sale" | "exclusive"; sig: string; wallet: string; refId?: string; species?: string; label?: string; ts: number };
function loadPending(): Pending[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as Pending[]; } catch { return []; }
}
function savePending(list: Pending[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* игнорируем */ }
}

// Воскрешение: цена лекарства = база + за каждый уровень питомца.
const REVIVE_BASE = 50;
const REVIVE_PER_LEVEL = 100;      // rare+ питомцы
const REVIVE_PER_LEVEL_BASE = 50;  // базовые (dog/cat/hamster) — дешевле оживить

// Скрещивание: открыто, когда есть два питомца уровня BREED_LEVEL+. Стоит BREED_COST, даёт случайного
// нового питомца (rare+). Phase 2: шансы/исход/проверку родителей выполняет СЕРВЕР (edge fn pets).
const BREED_LEVEL = 5;
const BREED_COST = 1000;

// Значок кошелька в окне выбора. Настоящую иконку присылает сам кошелёк (EIP-6963), но только если
// он УСТАНОВЛЕН — у неустановленных её взять неоткуда. Чтобы список не зиял пустыми квадратами,
// рисуем запасной кружок с первой буквой в узнаваемом цвете бренда.
function WalletIcon({ icon, name, color }: { icon?: string; name: string; color: string }) {
  // Настоящую иконку присылает сам кошелёк (EIP-6963) — но только если он УСТАНОВЛЕН.
  if (icon) return <img className="wallet-opt-icon" src={icon} alt="" />;
  // Для неустановленных рисуем сдержанную заглушку: контур в цвете бренда и буква тем же цветом.
  // Заливать её брендовым цветом нельзя — рядом с настоящими логотипами это выглядит как
  // подделка логотипа, хотя мы просто не знаем, как выглядит иконка непоставленного кошелька.
  return (
    <span
      className="wallet-opt-icon wallet-opt-icon-fallback"
      style={{ color, borderColor: color }}
      aria-hidden
    >
      {name.charAt(0)}
    </span>
  );
}

export default function App() {
  const [pet, setPet] = useState<SavedPet | null>(() => loadPet());
  const [picked, setPicked] = useState<PetId | null>(null);
  const [name, setName] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [accPicker, setAccPicker] = useState<string | null>(null); // accessory slot type being edited
  const [breedSel, setBreedSel] = useState<string[]>([]); // выбранные родители для скрещивания
  const [bred, setBred] = useState<{ id: string; rarity: Rarity } | null>(null); // результат скрещивания
  const [namePet, setNamePet] = useState<string | null>(null); // вид, которому задаём имя перед выбором
  const [petNameInput, setPetNameInput] = useState("");
  const [petMenu, setPetMenu] = useState(false); // панель взаимодействия с питомцем
  const [showBuffs, setShowBuffs] = useState(false); // раскрыта ли панель баффов (когда их >2)
  // раскрыт ли список квестов — на узких экранах (см. брейкпоинт 520px в App.css) по умолчанию свёрнут,
  // иначе fixed-панель квестов перекрывает карточку питомца (нет места сбоку, как на десктопе).
  const [questsOpen, setQuestsOpen] = useState(() => typeof window !== "undefined" && window.innerWidth > 520);
  const [wallet, setWallet] = useState<string | null>(null); // адрес подключённого кошелька (= ID игрока)
  const [walletMenu, setWalletMenu] = useState(false); // открыт ли попап кошелька
  const [foundWallets, setFoundWallets] = useState<WalletInfo[]>([]); // кошельки, найденные по EIP-6963
  const [cloudLoading, setCloudLoading] = useState(false); // идёт ли загрузка облачного сейва
  const [verified, setVerified] = useState(false); // подтверждён ли кошелёк подписью
  const [buying, setBuying] = useState(false); // идёт ли покупка DC за ETH
  const [adminReqs, setAdminReqs] = useState<SellRequest[] | null>(null); // pending-заявки на продажу (для админа)
  const [adminQuests, setAdminQuests] = useState<QuestClaim[] | null>(null); // pending-заявки на награды за квесты (для админа)
  const [adminStuck, setAdminStuck] = useState<SellRequest[] | null>(null); // застрявшие выплаты (error/paying)
  const [payoutBusy, setPayoutBusy] = useState(false); // идёт обработка выплаты (блок от двойного клика Approve/Reject)
  const [listBusy, setListBusy] = useState(false); // идёт выставление лота (блок от двойного клика List)
  const isAdmin = wallet === ADMIN_WALLET;
  const [topScores, setTopScores] = useState<ScoreRow[] | null>(null); // глобальный топ лидерборда
  const [lbLoaded, setLbLoaded] = useState(false); // загрузили ли топ (чтобы отличить загрузку от «пусто»)
  const [arenaTop, setArenaTop] = useState<ArenaRow[] | null>(null); // глобальный топ арены
  const [marketListings, setMarketListings] = useState<Listing[] | null>(null); // общие лоты рынка
  const [marketLoaded, setMarketLoaded] = useState(false); // загрузили ли лоты
  const [marketTab, setMarketTab] = useState<"exclusive" | "player" | "auction">("exclusive");
  const [listSpecies, setListSpecies] = useState<string>(""); // выбранный питомец для листинга
  const [listPrice, setListPrice] = useState<string>(""); // цена (ETH) для листинга
  const [exclusives, setExclusives] = useState<Exclusive[] | null>(null); // эксклюзивы от казны
  const [exLoaded, setExLoaded] = useState(false); // загрузили ли эксклюзивы
  const [exSpecies, setExSpecies] = useState<string>(""); // админ-форма: вид эксклюзива
  const [exPrice, setExPrice] = useState<string>(""); // админ-форма: цена ETH
  const [exStock, setExStock] = useState<string>("1"); // админ-форма: тираж
  const [toast, setToast] = useState("");
  const [caCopied, setCaCopied] = useState(false); // временная галочка на месте CA после копирования
  const [justFedId, setJustFedId] = useState<string | null>(null); // временная галочка "Fed ✓" на карточке еды
  const [levelUpFx, setLevelUpFx] = useState(false); // короткая анимация "LEVEL UP!" над питомцем
  // Chest opening: a roulette strip of emojis that scrolls and lands on the won one.
  // Display-only — the won item is already added to inventory/owned when the chest opens.
  type WonItem = { emoji: string; label: string; rarity: Rarity; rarityLabel?: string; rarityColor?: string };
  const [chest, setChest] = useState<{ won: WonItem; strip: string[]; colors: string[]; winIdx: number; revealed: boolean } | null>(null);
  const [reelOffset, setReelOffset] = useState(0);
  // Chest preview: shown when a chest is clicked, before spending. Lists possible drops.
  const [preview, setPreview] = useState<
    | { kind: "food"; chest: (typeof FOOD_CHESTS)[number] }
    | { kind: "accessory"; chest: (typeof ACC_CHESTS)[number] }
    | { kind: "pet"; chest: (typeof PET_CHESTS)[number] }
    | null
  >(null);

  useEffect(() => {
    if (pet) localStorage.setItem(STORAGE_KEY, JSON.stringify(pet));
    else localStorage.removeItem(STORAGE_KEY);
  }, [pet]);

  const petRef = useRef(pet);
  petRef.current = pet;
  // Подписи оплат, которые ПРЯМО СЕЙЧАС проверяются: processPurchase (свой цикл ретраев) и 30с-
  // реконсилятор незавершённых оплат могут случайно пересечься по времени для одной и той же
  // подписи — без этой защиты оба одновременно дёрнут settlePurchase и покажут два тоста подряд.
  const settlingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = petRef.current;
      // Мёртвый питомец (health = 0) заморожен — оживить лекарством. Касается ВСЕХ, включая базовых:
      // базовый пет умирает, если его не кормить (см. starveOnly в decay).
      if (!cur || cur.stats.health <= 0) return;
      const now = Date.now();
      const buffs = cur.buffs.filter((b) => b.expiresAt > now);
      const potions = cur.potions.filter((p) => p.expiresAt > now); // активные зелья
      const potEff = potionEffects(potions, now);
      const hours = (now - cur.updatedAt) / 3_600_000;
      const mr = mythicAcc(cur.accessories);
      // Пассивный DC теперь начисляет СЕРВЕР (edge fn pv, collect) — в клиентском тике его не трогаем.
      // Decay, then add mythic regen (leash→fullness, toy→happiness). Cap растёт с уровнем.
      // Зелье Vitality замедляет распад (множим итоговый decayMult на (1 − potEff.decay)).
      const cap = statCap(cur.level);
      const dm = decayMult(buffs, cur.accessories, cur.species, now);
      // starveOnly для базовых: их здоровье падает только от голода (fullness = 0), не от несчастья.
      let stats = decay(cur.stats, cur.updatedAt, now, { f: dm.f * (1 - potEff.decay), h: dm.h * (1 - potEff.decay) }, cap, 1, isBasePet(cur.species));
      stats = { ...stats, fullness: clamp(stats.fullness + mr.fRegen * hours, cap), happiness: clamp(stats.happiness + mr.hRegen * hours, cap) };
      // Passive XP from a mythic cap → level up while enough.
      let xp = cur.xp + mr.xpHr * hours;
      let level = cur.level;
      while (xp >= xpForLevel(level)) { xp -= xpForLevel(level); level++; }
      // Неактивные питомцы игрока тоже распадаются — в 10 раз медленнее (и не умирают, пока неактивны).
      const progress = decayInactive(cur.progress, cur.updatedAt, now);
      setPet({ ...cur, stats, xp, level, buffs, potions, progress, updatedAt: now });
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  // Отдельный лёгкий тик раз в секунду ТОЛЬКО для UI-обратных отсчётов (баффы, daily) — не трогает
  // игровую логику/сейв, поэтому таймеры на экране не "скачут" по 3с вместе с основным game-тиком.
  const [uiNow, setUiNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setUiNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Показать "LEVEL UP!" на короткое время, когда УРОВЕНЬ АКТИВНОГО пета вырос — но не при переключении
  // на другого (уже прокачанного) пета, поэтому дополнительно сверяем species с прошлым рендером.
  const prevLevelRef = useRef<number | undefined>(undefined);
  const prevSpeciesRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!pet) return;
    const prevLevel = prevLevelRef.current;
    const prevSpecies = prevSpeciesRef.current;
    prevLevelRef.current = pet.level;
    prevSpeciesRef.current = pet.species;
    if (prevSpecies === pet.species && prevLevel !== undefined && pet.level > prevLevel) {
      setLevelUpFx(true);
      playQwak(pet.species, "cheer");
      const t = setTimeout(() => setLevelUpFx(false), 1400);
      return () => clearTimeout(t);
    }
  }, [pet?.level, pet?.species]);

  // Кратковременный "+N XP" + вспышка полоски прогресса при получении опыта (кормление/квесты) —
  // сравниваем с предыдущим xp В ТОМ ЖЕ уровне/виде, чтобы не сработать на level-up (xp сбрасывается)
  // или на переключение пета (xp скачет на чужое значение).
  const prevXpRef = useRef<number | undefined>(undefined);
  const prevLevelForXpRef = useRef<number | undefined>(undefined);
  const prevSpeciesForXpRef = useRef<string | undefined>(undefined);
  const [xpGainFx, setXpGainFx] = useState<number | null>(null);
  useEffect(() => {
    if (!pet) return;
    const prevXp = prevXpRef.current;
    const prevLevel = prevLevelForXpRef.current;
    const prevSpecies = prevSpeciesForXpRef.current;
    prevXpRef.current = pet.xp;
    prevLevelForXpRef.current = pet.level;
    prevSpeciesForXpRef.current = pet.species;
    if (prevSpecies === pet.species && prevLevel === pet.level && prevXp !== undefined && pet.xp > prevXp) {
      const gained = Math.round(pet.xp - prevXp);
      if (gained > 0) {
        setXpGainFx(gained);
        const t = setTimeout(() => setXpGainFx(null), 1000);
        return () => clearTimeout(t);
      }
    }
  }, [pet?.xp, pet?.level, pet?.species]);

  // Тихий "тук" при открытии обычной модалки. Roulette/battle уже играют собственные звуки при
  // старте своей анимации — не дублируем их здесь.
  const prevModalRef = useRef<Modal>(null);
  useEffect(() => {
    if (modal && modal !== prevModalRef.current && modal !== "roulette" && modal !== "battle") {
      playModalSound();
    }
    prevModalRef.current = modal;
  }, [modal]);

  // Кратковременная золотая вспышка на балансе DC при его изменении (daily/quests/продажи/траты и т.д.).
  const prevCoinsRef = useRef<number | undefined>(undefined);
  const [coinsFx, setCoinsFx] = useState(false);
  useEffect(() => {
    if (!pet) return;
    const prevCoins = prevCoinsRef.current;
    prevCoinsRef.current = pet.coins;
    if (prevCoins !== undefined && pet.coins !== prevCoins) {
      setCoinsFx(true);
      const t = setTimeout(() => setCoinsFx(false), 600);
      return () => clearTimeout(t);
    }
  }, [pet?.coins]);

  // Тихий предупреждающий сигнал ОДИН РАЗ в момент, когда fullness/happiness пересекают порог 20% —
  // не на каждом 3с тике, пока стат остаётся низким (иначе задолбает спамом).
  const lowFullnessRef = useRef(false);
  const lowHappinessRef = useRef(false);
  useEffect(() => {
    if (!pet || pet.stats.health <= 0) return;
    const statCap20 = statCap(pet.level) * 0.2;
    const lowF = pet.stats.fullness < statCap20;
    const lowH = pet.stats.happiness < statCap20;
    if ((lowF && !lowFullnessRef.current) || (lowH && !lowHappinessRef.current)) {
      playLowStatSound();
    }
    lowFullnessRef.current = lowF;
    lowHappinessRef.current = lowH;
  }, [pet?.stats.fullness, pet?.stats.happiness, pet?.level, pet?.stats.health]);

  const [toastLeaving, setToastLeaving] = useState(false);
  useEffect(() => {
    if (!toast) { setToastLeaving(false); return; }
    setToastLeaving(false);
    const leaveT = setTimeout(() => setToastLeaving(true), 1900); // запускаем exit-анимацию чуть заранее
    const clearT = setTimeout(() => setToast(""), 2200);
    return () => { clearTimeout(leaveT); clearTimeout(clearT); };
  }, [toast]);

  // Кошелёк: тихое авто-переподключение (если доступ уже выдан) + слежение за сменой аккаунта/сети.
  // В EIP-1193 нет событий connect/disconnect про аккаунт — есть только accountsChanged (пустой
  // список = игрок отключил сайт в самом кошельке) и chainChanged.
  const [walletReady, setWalletReady] = useState(false); // кошельки объявились → можно вешать слушатели
  useEffect(() => {
    let cancelled = false;
    // Ждём объявлений EIP-6963: расширения отвечают не мгновенно, и без этой паузы getWallet()
    // на первом рендере вернул бы null, а тихое переподключение не сработало бы.
    discoverWallets().then((found) => {
      if (cancelled) return;
      setFoundWallets(found);
      setWalletReady(true);
      // Переподключаемся молча ТОЛЬКО если игрок раньше уже выбирал кошелёк — иначе на чистом
      // браузере мы бы дёрнули случайное расширение без спроса.
      if (selectedWallet() && getWallet()) {
        walletConnect({ silent: true }).then((addr) => { if (!cancelled) setWallet(addr); }).catch(() => {});
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Слежение за сменой аккаунта/сети — вешаем после того, как провайдер определился.
  // В EIP-1193 нет событий connect/disconnect про аккаунт — есть только accountsChanged (пустой
  // список = игрок отключил сайт в самом кошельке) и chainChanged.
  useEffect(() => {
    if (!walletReady || !getWallet()) return;
    return watchWallet({
      onAccount: (addr) => setWallet(addr),
      onChain: () => {}, // сеть проверяем и переключаем прямо перед оплатой (ensureChain в pay.ts)
    });
  }, [walletReady, wallet]);

  // Сессия верификации: при смене кошелька восстанавливаем сохранённый токен (если валиден).
  useEffect(() => {
    if (!wallet) { setSessionToken(null); setVerified(false); return; }
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { wallet: string; token: string };
        if (s.wallet === wallet && jwtExpMs(s.token) > Date.now()) {
          setSessionToken(s.token);
          setVerified(true);
          return;
        }
      }
    } catch { /* игнорируем */ }
    setSessionToken(null);
    setVerified(false);
  }, [wallet]);

  // Облако: при подключении кошелька грузим его сейв. Если у кошелька его ещё нет —
  // заливаем текущего локального питомца (чтобы прогресс не потерялся).
  useEffect(() => {
    if (!wallet || !isCloudEnabled()) return;
    let cancelled = false;
    setCloudLoading(true);
    loadCloudSave(wallet)
      .then((cloud) => {
        if (cancelled) return;
        const cloudPet = cloud ? hydrateSave(cloud) : null; // дозаполняем дефолтами (старые сейвы без новых полей)
        if (cloudPet) setPet(cloudPet); // облачный питомец этого кошелька — источник правды
        else if (petRef.current) saveCloudSave(wallet, petRef.current); // у кошелька сейва нет → заливаем локального
        const p = cloudPet ?? petRef.current;
        if (p && p.bestScore > 0) submitScore(wallet, p.name, p.bestScore); // засветиться в лидерборде
        if (p && p.battleWins + p.battleLosses > 0)
          submitArena({ wallet, name: p.name, species: p.species, power: loadoutPower(p.level, p.accessories, 0, speciesRarity(p.species)).power, wins: p.battleWins, losses: p.battleLosses });
        if (p) upsertPvpProfile({ wallet, name: p.name, species: p.species, level: p.level, accessories: p.accessories }); // профиль для PvP
        // Авторитетный баланс DC с сервера (начисляет пассив + бэкфилл). Требует верификации (JWT).
        if (p) pvSync(p.level).then((r) => { if (r && !cancelled) setPet((pp) => (pp ? { ...pp, coins: r.coins, lastDaily: r.lastDaily } : pp)); });
      })
      .finally(() => { if (!cancelled) setCloudLoading(false); });
    return () => { cancelled = true; };
  }, [wallet]);

  // Phase 2: авторитетный список владения — из pet_ledger (не из сейва). Сливаем его в сейв, где
  // ownedSpecies становится ЗЕРКАЛОМ леджера (как coins — зеркало balances). Так подделанный
  // ownedSpecies в localStorage — просто картинка: продать за ETH можно лишь то, что есть в леджере.
  useEffect(() => {
    if (!wallet || !verified || !isCloudEnabled()) return;
    let cancelled = false;
    (async () => {
      let ledger = await petsSync();
      if (cancelled || !ledger) return;
      // Леджер пуст → аккаунт ещё не в серверной модели (создан офлайн до Phase 2). Сеем стартер из
      // активного вида, если он обычный (бесплатный), затем перечитываем.
      if (ledger.length === 0) {
        const p = petRef.current;
        if (p && isBasePet(p.species)) {
          await petsStarter(p.species, p.name);
          ledger = (await petsSync()) ?? [];
        }
      }
      if (cancelled || ledger.length === 0) return;
      mergeLedger(ledger);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, verified]);

  // Привести сейв в соответствие с леджером: ownedSpecies = виды из леджера; имена/прогресс неактивных
  // видов дозаполняем из леджера; убираем из progress виды, которых в леджере уже нет (проданы/фейковые).
  function mergeLedger(ledger: LedgerPet[]) {
    setPet((p) => {
      if (!p) return p;
      const owned = ledger.map((l) => l.species);
      const names = { ...p.names };
      const progress = { ...p.progress };
      for (const l of ledger) {
        if (l.name && !names[l.species]) names[l.species] = l.name;
        if (l.species !== p.species && !progress[l.species]) {
          progress[l.species] = { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: l.level ?? 1, buffs: l.buffs ?? [] };
        }
      }
      for (const sp of Object.keys(progress)) if (!owned.includes(sp)) delete progress[sp];
      const next = { ...p, ownedSpecies: owned, names, progress, updatedAt: Date.now() };
      if (wallet) saveCloudSave(wallet, next);
      return next;
    });
  }

  // Лидерборд: подгружаем глобальный топ при открытии модалки Ranks.
  useEffect(() => {
    if (modal !== "leaderboard" || !isCloudEnabled()) return;
    let cancelled = false;
    setLbLoaded(false);
    fetchTopScores(20).then((rows) => {
      if (cancelled) return;
      setTopScores(rows);
      setLbLoaded(true);
    });
    return () => { cancelled = true; };
  }, [modal]);

  // Арена: подгружаем глобальный рейтинг при открытии Battle Arena.
  useEffect(() => {
    if (modal !== "battle" || !isCloudEnabled()) return;
    let cancelled = false;
    setArenaTop(null);
    fetchTopArena(20).then((rows) => { if (!cancelled) setArenaTop(rows); });
    return () => { cancelled = true; };
  }, [modal]);

  // Админ: подгружаем pending-заявки на продажу и на награды за квесты при открытии админ-панели.
  useEffect(() => {
    if (modal !== "admin" || !isAdmin) return;
    let cancelled = false;
    setAdminReqs(null);
    setAdminQuests(null);
    setAdminStuck(null);
    fetchSellRequests("pending").then((rows) => { if (!cancelled) setAdminReqs(rows ?? []); });
    fetchQuestClaims("pending").then((rows) => { if (!cancelled) setAdminQuests(rows ?? []); });
    fetchStuckSellRequests().then((rows) => { if (!cancelled) setAdminStuck(rows ?? []); });
    return () => { cancelled = true; };
  }, [modal, isAdmin]);

  // Рынок: подгружаем лоты игроков (вкладка Player) или эксклюзивы (вкладка Exclusive).
  useEffect(() => {
    if (modal !== "market" || !isCloudEnabled()) return;
    let cancelled = false;
    if (marketTab === "player") {
      setMarketLoaded(false);
      fetchListings("sale").then((rows) => {
        if (cancelled) return;
        setMarketListings(rows);
        setMarketLoaded(true);
      });
    } else if (marketTab === "exclusive") {
      setExLoaded(false);
      fetchExclusives().then((rows) => {
        if (cancelled) return;
        setExclusives(rows);
        setExLoaded(true);
      });
    }
    return () => { cancelled = true; };
  }, [modal, marketTab]);

  // Квесты — глобальная гонка: первый заявивший награду закрывает квест для всех (см. quests.ts).
  // Карта quest_id → кошелёк, кто закрыл — публичные данные, видны всем игрокам, даже без кошелька.
  const [claimedQuests, setClaimedQuests] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isCloudEnabled()) return;
    let cancelled = false;
    function load() {
      fetchClaimedQuestIds().then((map) => { if (!cancelled && map) setClaimedQuests(map); });
    }
    load();
    const iv = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Облако: периодически сохраняем прогресс + обновляем боевой профиль для PvP (раз в 20с).
  useEffect(() => {
    if (!wallet || !isCloudEnabled()) return;
    const iv = setInterval(() => {
      const p = petRef.current;
      if (!p) return;
      saveCloudSave(wallet, p);
      upsertPvpProfile({ wallet, name: p.name, species: p.species, level: p.level, accessories: p.accessories });
      // Пассив начисляет сервер: периодически синхронизируем баланс (если кошелёк верифицирован).
      if (isVerified()) pvSync(p.level).then((r) => { if (r) setPet((pp) => (pp ? { ...pp, coins: r.coins } : pp)); });
    }, 20000);
    return () => clearInterval(iv);
  }, [wallet]);

  // Реконсилятор незавершённых оплат: добиваем платежи, которые не успели подтвердиться (сеть ещё
  // не видит tx / RPC подвис) — сеть рано или поздно увидит tx → DC начислится / пет выдастся
  // (идемпотентно). Раньше это запускалось ТОЛЬКО при смене wallet/verified — если игрок просто
  // оставался в той же сессии и не переподключался/не перезагружал страницу, платёж мог зависнуть
  // в pending надолго. Теперь дополнительно повторяем по таймеру, пока сессия открыта.
  useEffect(() => {
    if (!wallet || !verified || !isCloudEnabled()) return;
    let cancelled = false;
    async function reconcilePending() {
      for (const e of loadPending()) {
        if (cancelled) return;
        const r = await settlePurchase(e);
        if (r === "done") removePending(e.sig);
      }
    }
    reconcilePending();
    const iv = setInterval(reconcilePending, 30000);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, verified]);

  function createPet() {
    if (!picked || !name.trim()) return;
    setPet({
      species: picked,
      name: name.trim(),
      names: { [picked]: name.trim() },
      stats: { fullness: 100, happiness: 100, health: 100 },
      coins: START_COINS,
      sol: 0,
      inventory: {},
      ownedSpecies: [picked],
      ownedAccessories: [...STARTER_ACCESSORIES],
      accessories: [],
      xp: 0,
      level: 1,
      buffs: [],
      powerBuff: null,
      potionInv: {},
      potions: [],
      questClaimed: [],
      questDone: [],
      listings: [],
      progress: {},
      lastDaily: 0,
      dailyStreak: 0,
      totalScore: 0,
      bestScore: 0,
      lastRunReward: 0,
      battleWins: 0,
      battleLosses: 0,
      grantV: GRANT_V,
      updatedAt: Date.now(),
    });
    // Phase 2: стартовый питомец выдаётся сервером в pet_ledger (если кошелёк уже верифицирован;
    // иначе засеется позже при синхронизации леджера). ownedSpecies в сейве — лишь зеркало.
    if (wallet && verified && isCloudEnabled()) petsStarter(picked, name.trim());
    playQwak(picked);
    setToast(`Qwak! ${name.trim()} is awake 🦆`);
  }


  // Effective price after the active species' shop discount (if any).
  function price(base: number): number {
    return Math.ceil(base * (pet ? 1 - speciesEffect(pet.species).shop : 1));
  }

  // Buy a food → goes into the inventory (does NOT feed immediately). DC списывается на сервере.
  async function buyFood(food: Food) {
    if (!pet) return;
    const cost = price(food.cost);
    const ok = await doSpend(cost, (coins) => setPet((p) => (p ? { ...p, coins, inventory: { ...p.inventory, [food.id]: (p.inventory[food.id] ?? 0) + 1 } } : p)));
    if (ok) setToast(`Bought ${food.label} ${food.emoji}`);
  }

  // Open a chest → build a roulette strip, scroll it, then drop the food into the inventory.
  const REEL_LEN = 40;
  const REEL_WIN = 34; // winning item sits near the end so there's a run-up
  // Build a roulette strip with the won item at the winning index, plus a color per
  // cell (its rarity color) so the spinning reel is colorful.
  // Ячейка барабана: обычные предметы — эмодзи, утки — свой арт (значение вида "pet:<id>").
  function buildStrip(pool: readonly { emoji: string; rarity: Rarity }[], won: { emoji: string; rarity: Rarity }): { strip: string[]; colors: string[] } {
    const strip: string[] = [];
    const colors: string[] = [];
    for (let i = 0; i < REEL_LEN; i++) {
      const it = i === REEL_WIN ? won : pool[Math.floor(Math.random() * pool.length)];
      strip.push(it.emoji);
      colors.push(RARITY[it.rarity].color);
    }
    return { strip, colors };
  }

  // Food chest. Анимацию запускаем СРАЗУ (предмет уже выбран), DC списываем на сервере параллельно —
  // так нет паузы перед прокрутом. При отказе сервера отменяем показ и откатываем баланс.
  async function openChest(c: (typeof FOOD_CHESTS)[number]) {
    if (!pet) return;
    const cost = price(c.cost);
    if (!rewardsUnlocked) return setToast(`Connect & verify your wallet to spend ${SIL}`);
    if (Math.floor(pet.coins) < cost) return setToast(`Not enough ${SIL}`);
    const won = rollFood(c.odds);
    setReelOffset(0);
    const reel = buildStrip(FOODS, won);
    playSpinSound(SPIN_MS / 1000); // играть звук РОВНО тогда, когда барабан реально начинает крутиться
    setChest({
      won: { emoji: won.emoji, label: won.label, rarity: won.rarity, rarityLabel: RARITY[won.rarity].label, rarityColor: RARITY[won.rarity].color },
      strip: reel.strip,
      colors: reel.colors,
      winIdx: REEL_WIN,
      revealed: false,
    });
    const res = await pvSpend(cost);
    if ("error" in res) {
      if (typeof res.coins === "number") setCoins(res.coins);
      setChest(null);
      return setToast(res.error === "not enough PV" ? `Not enough ${SIL}` : "Purchase failed — try again");
    }
    setPet((p) => (p ? { ...p, coins: res.coins, inventory: { ...p.inventory, [won.id]: (p.inventory[won.id] ?? 0) + 1 } } : p));
  }

  // Accessory chest → roll a rarity by the chest's odds, then a random unowned accessory.
  async function openAccessoryChest(c: (typeof ACC_CHESTS)[number]) {
    if (!pet) return;
    const cost = price(c.cost);
    const missing = ACCESSORIES.filter((a) => !pet.ownedAccessories.includes(a.id));
    if (missing.length === 0) return setToast("You own every accessory! 🎉");
    // Roll a rarity; if nothing of that rarity is left, fall back to any unowned.
    const rarity = rollRarity(c.odds);
    const pool = missing.filter((a) => a.rarity === rarity);
    const from = pool.length ? pool : missing;
    const won = from[Math.floor(Math.random() * from.length)];
    if (!rewardsUnlocked) return setToast(`Connect & verify your wallet to spend ${SIL}`);
    if (Math.floor(pet.coins) < cost) return setToast(`Not enough ${SIL}`);
    setReelOffset(0);
    const reel = buildStrip(ACCESSORIES, won);
    playSpinSound(SPIN_MS / 1000); // играть звук РОВНО тогда, когда барабан реально начинает крутиться
    setChest({
      won: { emoji: won.emoji, label: won.label, rarity: won.rarity, rarityLabel: RARITY[won.rarity].label, rarityColor: RARITY[won.rarity].color },
      strip: reel.strip,
      colors: reel.colors,
      winIdx: REEL_WIN,
      revealed: false,
    });
    const res = await pvSpend(cost);
    if ("error" in res) {
      if (typeof res.coins === "number") setCoins(res.coins);
      setChest(null);
      return setToast(res.error === "not enough PV" ? `Not enough ${SIL}` : "Purchase failed — try again");
    }
    setPet((p) => (p ? { ...p, coins: res.coins, ownedAccessories: [...p.ownedAccessories, won.id] } : p));
  }

  // Animate the roulette: start at 0, then slide so the winning item lands under the pointer.
  useEffect(() => {
    if (!chest || chest.revealed) return;
    const ITEM = 80; // px, must match .reel-item width in CSS
    const CENTER = 100; // (viewport 280 / 2) − (item 80 / 2)
    const target = -(chest.winIdx * ITEM - CENTER);
    const start = setTimeout(() => setReelOffset(target), 50); // let it render at 0 first, then transition
    const epicPlus = chest.won.rarity === "epic" || chest.won.rarity === "legendary" || chest.won.rarity === "mythic";
    const done = setTimeout(() => {
      setChest((c) => (c ? { ...c, revealed: true } : c));
      if (epicPlus) playWinSound(); // на редкий дроп — звук как при выигрыше в рулетке
    }, SPIN_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(done);
    };
  }, [chest]);

  // Pet chest (Phase 2): вид и списание DC решает СЕРВЕР (edge fn pets → pet_ledger). Клиент только
  // показывает результат. Так пета нельзя намайнить, подделав сейв — он появляется только в леджере.
  async function openPetChest(c: (typeof PET_CHESTS)[number]) {
    if (!pet) return;
    if (!rewardsUnlocked) return setToast(`Connect & verify your wallet to spend ${SIL}`);
    // Common starter pets (dog/cat/hamster) are never dropped by chests.
    const missing = PETS.filter((p) => p.rarity !== "common" && !pet.ownedSpecies.includes(p.id));
    if (missing.length === 0) return setToast("You own every duck! 🎉");
    if (Math.floor(pet.coins) < price(c.cost)) return setToast(`Not enough ${SIL}`);
    // Сервер: списывает DC, бросает кубик, пишет пета в леджер. active — для скидки магазина по перку.
    const res = await petsChest(c.id, pet.species);
    if ("error" in res) {
      if (typeof res.coins === "number") setCoins(res.coins);
      return setToast(res.error === "not enough PV" ? `Not enough ${SIL}` : res.error === "own all" ? "You own every duck! 🎉" : "Purchase failed — try again");
    }
    const won = PETS.find((p) => p.id === res.species);
    if (!won) return;
    setReelOffset(0);
    // В барабане уток показываем артом, а не эмодзи → маркер "pet:<id>" (см. ReelIcon).
    const petPool = PETS.map((p) => ({ emoji: `pet:${p.id}`, rarity: p.rarity }));
    const reel = buildStrip(petPool, { emoji: `pet:${won.id}`, rarity: won.rarity });
    playSpinSound(SPIN_MS / 1000); // играть звук РОВНО тогда, когда барабан реально начинает крутиться (после ответа сервера)
    setChest({
      won: { emoji: `pet:${won.id}`, label: won.label, rarity: won.rarity, rarityLabel: RARITY[won.rarity].label, rarityColor: RARITY[won.rarity].color },
      strip: reel.strip,
      colors: reel.colors,
      winIdx: REEL_WIN,
      revealed: false,
    });
    setPet((p) => (p ? { ...p, coins: res.coins, ownedSpecies: [...p.ownedSpecies, won.id], updatedAt: Date.now() } : p));
  }

  // Spin the previewed chest (pay + roll + animation), then close the preview.
  // Звук крутки теперь запускается в openChest/openAccessoryChest/openPetChest — РЯДОМ с setChest(...),
  // а не здесь. Раньше он стартовал тут сразу по клику: для петов ролл решает сервер (await petsChest),
  // так что барабан начинал крутиться заметно позже звука; а если игрок уже владел всем (пет/аксессуар),
  // открытие сундука сразу выходило до setChest — барабан не показывался вовсе, а звук уже успевал сыграть.
  function spinPreview() {
    if (!preview) return;
    if (preview.kind === "food") openChest(preview.chest);
    else if (preview.kind === "accessory") openAccessoryChest(preview.chest);
    else openPetChest(preview.chest);
    setPreview(null);
  }

  // Feed the pet from the inventory → consumes one item, applies stats, XP and buffs.
  function feedFromInventory(food: Food) {
    if (!pet || (pet.inventory[food.id] ?? 0) <= 0) return;
    const now = Date.now();

    // XP gain — boosted by equipped caps (amplified by species "acc" perk), species "xp" perk
    // и зельем мудрости (potEff.xp).
    const sp = speciesEffect(pet.species);
    const potEff = potionEffects(pet.potions, now);
    const xpMult = equippedBonuses(pet.accessories).xpMult * (1 + sp.acc) + sp.xp + potEff.xp;
    const xpGain = Math.round(XP_BY_RARITY[food.rarity] * (1 + xpMult));
    let xp = pet.xp + xpGain;
    let level = pet.level;
    let leveled = false;
    while (xp >= xpForLevel(level)) {
      xp -= xpForLevel(level);
      level++;
      leveled = true;
    }

    // Свой бафф конкретной еды (refreshes if same buff already active).
    const bk = FOOD_BUFF[food.id];
    let buffs = pet.buffs.filter((b) => b.expiresAt > now);
    if (bk) buffs = [...buffs.filter((b) => b.kind !== bk), { kind: bk, expiresAt: now + BUFFS[bk].durationMs }];

    // Макс вместимость растёт с (возможно новым) уровнем.
    const cap = statCap(level);

    // Еда epic+ даёт временную прибавку боевой силы (Игра №2).
    const pw = FOOD_POWER[food.rarity];
    const powerBuff = pw > 0
      ? { amount: Math.max(pw, activePowerBuff(pet.powerBuff, now)), expiresAt: now + 3_600_000 }
      : pet.powerBuff;

    setPet({
      ...pet,
      inventory: { ...pet.inventory, [food.id]: pet.inventory[food.id] - 1 },
      // Mythic food fully restores every stat (до текущего cap); otherwise add the food's effect.
      stats:
        food.rarity === "mythic"
          ? { fullness: cap, happiness: cap, health: 100 }
          : {
              ...pet.stats,
              fullness: clamp(pet.stats.fullness + food.fullness * (1 + sp.food), cap),
              happiness: clamp(pet.stats.happiness + food.happiness * (1 + sp.food), cap),
            },
      xp,
      level,
      buffs,
      powerBuff,
      updatedAt: now,
    });
    setToast(
      leveled
        ? `🎉 ${pet.name} reached level ${level}!`
        : bk
        ? `Yum! ${BUFFS[bk].emoji} ${BUFFS[bk].label} active`
        : `Yum! ${pet.name} ate a ${food.label.toLowerCase()} ${food.emoji}`,
    );
    playQwak(pet.species, "peck"); // клевок; на левелапе поверх него ляжет радостный возглас
    setJustFedId(food.id);
    setTimeout(() => setJustFedId((id) => (id === food.id ? null : id)), 500);
  }

  // Обновить локальное ЗЕРКАЛО баланса DC значением, пришедшим с сервера (авторитет — balances).
  function setCoins(coins: number) {
    setPet((prev) => (prev ? { ...prev, coins, updatedAt: Date.now() } : prev));
  }
  // Списать DC на СЕРВЕРЕ под покупку; при успехе применить эффект (apply получает новый баланс).
  // Экономика требует верифицированного кошелька (баланс живёт на сервере).
  async function doSpend(cost: number, apply: (coins: number) => void): Promise<boolean> {
    if (!rewardsUnlocked) { setToast(`Connect & verify your wallet to spend ${SIL}`); return false; }
    if (pet && Math.floor(pet.coins) < cost) { setToast(`Not enough ${SIL}`); return false; }
    const res = await pvSpend(cost);
    if ("error" in res) {
      if (typeof res.coins === "number") setCoins(res.coins);
      setToast(res.error === "not enough PV" ? `Not enough ${SIL}` : "Purchase failed — try again");
      return false;
    }
    apply(res.coins);
    return true;
  }

  // Кнопка «Connect wallet» открывает ВЫБОР кошелька, а не подключает сразу: у игрока может стоять
  // несколько кошельков, и молча подключать случайный — плохо (см. EIP-6963 в game/wallet.ts).
  function openWalletPicker() {
    setModal("wallets");
    discoverWallets().then(setFoundWallets); // список приезжает асинхронно, окно уже открыто
  }

  // Пока окно выбора открыто, слушаем поздние объявления кошельков: расширение может
  // проинициализироваться через секунду после открытия, и список должен обновиться сам.
  useEffect(() => {
    if (modal !== "wallets") return;
    return onWalletsChanged(() => { discoverWallets(0).then(setFoundWallets); });
  }, [modal]);

  // Подключить КОНКРЕТНЫЙ кошелёк, выбранный в окне.
  async function connectWallet(rdns: string) {
    setModal(null);
    try {
      const addr = await walletConnect({ rdns });
      if (!addr) return setToast("Connection cancelled");
      setWallet(addr);
      setToast("👛 Wallet connected");
      // Авто-верификация при первом подключении (если нет валидного сохранённого токена).
      let hasValid = false;
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        const s = raw ? (JSON.parse(raw) as { wallet: string; token: string }) : null;
        hasValid = !!(s && s.wallet === addr && jwtExpMs(s.token) > Date.now());
      } catch { /* нет токена */ }
      if (!hasValid && isCloudEnabled()) verifyWallet(addr);
    } catch {
      setToast("Connection cancelled");
    }
  }
  async function disconnectWallet() {
    if (wallet && petRef.current) await saveCloudSave(wallet, petRef.current); // сохраняем последнее состояние
    await walletDisconnect(); // best-effort: не каждый EVM-кошелёк умеет отзывать доступ по просьбе сайта
    setWallet(null);
    setWalletMenu(false);
    setToast("Wallet disconnected");
  }

  // Верификация: подписываем сообщение кошельком → получаем токен (доказывает, что адрес твой).
  async function verifyWallet(addr?: string) {
    const w = addr ?? wallet;
    if (!getWallet() || !w) return;
    const message = `Sign in to Duckverse\nwallet: ${w}\nts:${Date.now()}`;
    try {
      const sigHex = await signMessageHex(w, message);
      const token = await signIn(w, message, sigHex);
      if (token) {
        setVerified(true);
        setWalletMenu(false);
        localStorage.setItem(SESSION_KEY, JSON.stringify({ wallet: w, token }));
        setToast("✅ Wallet verified");
      } else {
        setToast("Verification failed — is the auth function deployed?");
      }
    } catch {
      setToast("Signature cancelled");
    }
  }

  function addPending(e: Pending) { savePending([...loadPending().filter((x) => x.sig !== e.sig), e]); }
  function removePending(sig: string) { savePending(loadPending().filter((x) => x.sig !== sig)); }

  // Убрать список id аксессуаров отовсюду (с активного пета и с прогресса остальных), кроме одного
  // вида — вызывается, когда питомец с уже надетыми аксессуарами приходит в сейв ИЗВНЕ (покупка на
  // рынке, возврат при отмене листинга). Без этого один и тот же аксессуар мог оказаться "надет"
  // сразу на двух питомцах (свой + купленный/возвращённый), если id совпал.
  function stripAccessoriesElsewhere(activeAccessories: string[], progress: SavedPet["progress"], ids: string[], exceptSpecies: string) {
    if (!ids.length) return { activeAccessories, progress };
    const set = new Set(ids);
    const newActive = activeAccessories.filter((a) => !set.has(a));
    const newProgress = { ...progress };
    for (const sp of Object.keys(newProgress)) {
      if (sp === exceptSpecies) continue;
      const on = newProgress[sp].accessories ?? [];
      if (on.some((a) => set.has(a))) newProgress[sp] = { ...newProgress[sp], accessories: on.filter((a) => !set.has(a)) };
    }
    return { activeAccessories: newActive, progress: newProgress };
  }

  // Добавить купленного пета в локальный сейв (аддитивно — только этот вид, не затирая свежий прогресс).
  function applyBought(sp: string, serverSave: SavedPet) {
    setPet((p) => {
      if (!p) return hydrateSave(serverSave);
      if (p.ownedSpecies.includes(sp)) return p;
      const prog = serverSave.progress?.[sp] ?? { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: 1, buffs: [] };
      // Питомец пришёл с надетыми аксессуарами → добавляем их и в общий инвентарь (ownedAccessories),
      // сняв их со всех, на ком они уже могли быть надеты (не должно повторяться, но подстрахуемся).
      const acc = prog.accessories ?? [];
      const { activeAccessories, progress: strippedProgress } = stripAccessoriesElsewhere(p.accessories, p.progress, acc, sp);
      const merged = { ...p, accessories: activeAccessories, ownedSpecies: [...p.ownedSpecies, sp], ownedAccessories: acc.length ? Array.from(new Set([...p.ownedAccessories, ...acc])) : p.ownedAccessories, progress: { ...strippedProgress, [sp]: prog }, names: serverSave.names?.[sp] ? { ...p.names, [sp]: serverSave.names[sp] } : p.names, updatedAt: Date.now() };
      if (wallet) saveCloudSave(wallet, merged);
      return merged;
    });
  }

  // Подтвердить одну оплату. "retry" = tx ещё не видна (повторить позже); "done" = завершено/ошибка.
  async function settlePurchase(e: Pending): Promise<"done" | "retry"> {
    if (!wallet) return "retry";
    // Эта же подпись уже проверяется другим вызовом (см. settlingRef выше) — не дублируем запрос/тост.
    if (settlingRef.current.has(e.sig)) return "retry";
    settlingRef.current.add(e.sig);
    try {
      // Старые записи в localStorage (до этого фикса) не хранили wallet — подстрахуемся текущим состоянием.
      const payer = e.wallet ?? wallet;
      if (e.kind === "pv") {
        const res = await confirmPurchase(payer, e.sig);
        if ("coins" in res) { setCoins(res.coins); setToast(`✅ +${res.credited.toLocaleString()} ${SIL} added!`); return "done"; }
        if (res.notFound) return "retry";
        if (res.already) { pvSync(pet?.level ?? 1).then((r) => r && setCoins(r.coins)); setToast(`✅ ${SIL} credited`); return "done"; }
        setToast(`Purchase issue: ${res.error}`); return "done";
      }
      const res = await confirmMarketBuy(e.kind, e.refId!, e.sig, payer);
      if ("save" in res) {
        if (e.species) applyBought(e.species, res.save);
        setToast(`✅ Bought ${e.label ?? "duck"}!`);
        if (e.kind === "sale") fetchListings("sale").then(setMarketListings);
        else fetchExclusives().then(setExclusives);
        return "done";
      }
      if (res.notFound) return "retry";
      // Не 404 → сделка завершена на сервере (уже обработано / оформлен возврат). Перечитаем сейв,
      // чтобы подхватить пета, если он всё же выдан.
      setToast(res.refund ? "Couldn't complete — refund queued (admin returns your ETH)" : "Purchase settled");
      loadCloudSave(wallet).then((s) => { if (s) setPet(hydrateSave(s)); });
      return "done";
    } finally {
      settlingRef.current.delete(e.sig);
    }
  }

  // Обработать оплату: сохранить в pending, затем повторять подтверждение с бэкоффом.
  async function processPurchase(e: Pending) {
    addPending(e);
    for (let i = 0; i < 3; i++) {
      const r = await settlePurchase(e);
      if (r === "done") { removePending(e.sig); return; }
      await new Promise((res) => setTimeout(res, 4000));
    }
    setToast("Payment sent — finalizing on-chain. We'll keep retrying automatically.");
  }

  // Реальная покупка DC за ETH: кошелёк игрока отправляет ETH на treasury → сервер проверяет и начисляет DC.
  async function buyPvReal(sol: number) {
    if (!wallet) return setToast("Connect wallet first");
    if (!verified) return setToast("Verify your wallet first (wallet menu)");
    setBuying(true);
    // Казна ещё не настроена (нулевой адрес) — платить некуда. Явное сообщение вместо
    // «Payment cancelled», чтобы не выглядело, будто игрок сам отменил оплату.
    if (!isTreasuryConfigured()) { setBuying(false); return setToast("Payments are not available yet"); }
    setToast("Confirm the payment in your wallet…");
    try {
      const paid = await sendPayment(sol);
      if (!paid) { setBuying(false); return setToast("Payment cancelled"); }
      setToast("Verifying payment on-chain…");
      await processPurchase({ kind: "pv", sig: paid.signature, wallet: paid.payer, ts: Date.now() });
    } catch {
      setToast("Purchase failed");
    }
    setBuying(false);
  }

  // Запрос на продажу DC → ETH: сервер держит DC, выплата после ручного подтверждения.
  async function sellPvReq(pv: number) {
    if (!wallet) return setToast("Connect wallet first");
    if (!pet || Math.floor(pet.coins) < pv) return setToast(`Not enough ${SIL}`);
    setBuying(true);
    const res = await requestSell(pv);
    if ("coins" in res) {
      setPet((p) => (p ? { ...p, coins: res.coins, updatedAt: Date.now() } : p));
      setToast(`📨 Sell request: ${pv.toLocaleString()} ${SIL} → ${res.sol} ETH (awaiting approval)`);
    } else {
      setToast(`Sell failed: ${res.error}`);
    }
    setBuying(false);
  }

  // Админ: approve (выплата ETH), reject (возврат DC для kind='sell') или reset (застрявшую → в очередь).
  async function doPayout(id: string, action: "approve" | "reject" | "reset") {
    if (payoutBusy) return; // защита от двойного клика (сервер тоже атомарно защищён)
    setPayoutBusy(true);
    setToast(action === "approve" ? "Sending ETH from treasury…" : action === "reject" ? "Rejecting…" : "Resetting…");
    const res = await payoutSell(id, action);
    if ("ok" in res) {
      setToast(action === "approve" ? `✅ Paid out${res.sig ? ` (${shortAddress(res.sig)})` : ""}` : action === "reject" ? "↩️ Rejected — DC refunded" : "↩️ Reset to pending");
      fetchSellRequests("pending").then((rows) => setAdminReqs(rows ?? []));
      fetchStuckSellRequests().then((rows) => setAdminStuck(rows ?? []));
    } else {
      setToast(`Failed: ${res.error}`);
    }
    setPayoutBusy(false);
  }

  // Админ: отметить заявку на награду за квест выплаченной (ETH отправляется вручную из кошелька казны).
  async function doQuestPaid(id: string) {
    if (payoutBusy) return;
    setPayoutBusy(true);
    const ok = await markQuestClaimPaid(id);
    if (ok) {
      setToast("✅ Marked paid");
      fetchQuestClaims("pending").then((rows) => setAdminQuests(rows ?? []));
    } else {
      setToast("Failed to mark paid");
    }
    setPayoutBusy(false);
  }

  // Цена лекарства для воскрешения = база + за уровень. Базовые питомцы дешевле (50 + 50/уровень).
  function reviveCostFor(level: number, species: string): number {
    return REVIVE_BASE + (isBasePet(species) ? REVIVE_PER_LEVEL_BASE : REVIVE_PER_LEVEL) * level;
  }

  // Сколько fullness тратит игра: 5 при заходе <7с, иначе 5 + 5 за каждые 20с игры.
  function playFullnessCost(durationMs: number): number {
    const sec = durationMs / 1000;
    return sec < 7 ? 5 : 5 + 5 * Math.floor(sec / 20);
  }

  // Итог боя в Игре №2. Победа → XP + вещь локально; DC (ставка + капнутая награда) считает СЕРВЕР.
  async function battleWin(kind: "accessory" | "food", id: string, bet: number) {
    if (!pet) return;
    const now = Date.now();
    const stake = Math.min(Math.max(0, bet), Math.floor(pet.coins));
    let xp = pet.xp + 60;
    let level = pet.level;
    while (xp >= xpForLevel(level)) { xp -= xpForLevel(level); level++; }
    let inventory = pet.inventory;
    let ownedAccessories = pet.ownedAccessories;
    let lootLabel = "loot";
    if (kind === "accessory") {
      if (!pet.ownedAccessories.includes(id)) ownedAccessories = [...pet.ownedAccessories, id];
      lootLabel = ACCESSORIES.find((a) => a.id === id)?.label ?? "an accessory";
    } else {
      inventory = { ...pet.inventory, [id]: (pet.inventory[id] ?? 0) + 1 };
      lootLabel = FOODS.find((f) => f.id === id)?.label ?? "food";
    }
    const res = await pvBattle(stake, true, pet.level); // серверный расчёт DC
    const coins = "error" in res ? pet.coins : res.coins;
    setPet({ ...pet, coins, xp, level, battleWins: pet.battleWins + 1, inventory, ownedAccessories, updatedAt: now });
    if (wallet) submitArena({ wallet, name: pet.name, species: pet.species, power: loadoutPower(pet.level, pet.accessories, 0, speciesRarity(pet.species)).power, wins: pet.battleWins + 1, losses: pet.battleLosses });
    const pvNote = "error" in res ? " (DC needs a verified wallet)" : res.locked ? " · arena DC unlocks at 10+ players" : "";
    setToast(`🏆 Victory! +60 XP, looted ${lootLabel}${pvNote}`);
  }

  // Победа над async-снимком/ботом (не настоящий live-соперник) — DC + XP как обычно, но БЕЗ добычи:
  // предмет теряет только реальный игрок в живом бою, а у снимка/бота и терять-то нечего по-настоящему.
  async function battleWinNoLoot(bet: number) {
    if (!pet) return;
    const now = Date.now();
    const stake = Math.min(Math.max(0, bet), Math.floor(pet.coins));
    let xp = pet.xp + 60;
    let level = pet.level;
    while (xp >= xpForLevel(level)) { xp -= xpForLevel(level); level++; }
    const res = await pvBattle(stake, true, pet.level); // серверный расчёт DC
    const coins = "error" in res ? pet.coins : res.coins;
    setPet({ ...pet, coins, xp, level, battleWins: pet.battleWins + 1, updatedAt: now });
    if (wallet) submitArena({ wallet, name: pet.name, species: pet.species, power: loadoutPower(pet.level, pet.accessories, 0, speciesRarity(pet.species)).power, wins: pet.battleWins + 1, losses: pet.battleLosses });
    const pvNote = "error" in res ? " (DC needs a verified wallet)" : res.locked ? " · arena DC unlocks at 10+ players" : "";
    setToast(`🏆 Victory! +60 XP${pvNote}`);
  }

  // Поражение: питомец теряет 10 HP (в обморок НЕ падает) и проигрывает ставку (списывает СЕРВЕР).
  // lostAccessoryId — задан только на LIVE-поражении (см. BattleGame.pickLootAccessory): выбран из
  // pet.accessories (это ровно то, что передавалось боем как надетое снаряжение), победитель
  // независимо вычислил тот же id и получает его себе — здесь реально снимаем и убираем его у нас.
  async function battleLose(bet: number, lostAccessoryId?: string | null) {
    if (!pet) return;
    const now = Date.now();
    const stake = Math.min(Math.max(0, bet), Math.floor(pet.coins));
    // Базовые питомцы умирают ТОЛЬКО от голода — бой не может их убить (пол здоровья = 1).
    const health = Math.max(isBasePet(pet.species) ? 1 : 0, pet.stats.health - 10);
    const res = await pvBattle(stake, false, pet.level);
    const coins = "error" in res ? pet.coins : res.coins;
    const accessories = lostAccessoryId ? pet.accessories.filter((id) => id !== lostAccessoryId) : pet.accessories;
    const ownedAccessories = lostAccessoryId ? pet.ownedAccessories.filter((id) => id !== lostAccessoryId) : pet.ownedAccessories;
    setPet({ ...pet, stats: { ...pet.stats, health }, coins, accessories, ownedAccessories, battleLosses: pet.battleLosses + 1, updatedAt: now });
    if (wallet) submitArena({ wallet, name: pet.name, species: pet.species, power: loadoutPower(pet.level, accessories, 0, speciesRarity(pet.species)).power, wins: pet.battleWins, losses: pet.battleLosses + 1 });
    const lootNote = lostAccessoryId ? ` — the winner looted your ${ACCESSORIES.find((a) => a.id === lostAccessoryId)?.label ?? "accessory"}!` : "";
    setToast(`💔 Defeat! ${pet.name} took 10 damage${stake ? ` and lost ${stake} ${SIL}` : ""}${lootNote}`);
  }

  // Погладить питомца — даёт бафф «Cuddled»: −10% к распаду сытости и счастья на 1 час.
  function pat() {
    if (!pet || pet.stats.health <= 0) return;
    const now = Date.now();
    const buffs = [
      ...pet.buffs.filter((b) => b.kind !== "cuddled" && b.expiresAt > now),
      { kind: "cuddled" as BuffKind, expiresAt: now + BUFFS.cuddled.durationMs },
    ];
    setPet({ ...pet, buffs, updatedAt: now });
    setToast(`🤚 ${pet.name} feels loved — 🤚 Cuddled: −10% decay for 1h`);
  }
  // Воскресить мёртвого питомца за лекарство (DC списывается на сервере).
  async function revivePet() {
    if (!pet || pet.stats.health > 0) return;
    const cost = reviveCostFor(pet.level, pet.species);
    const ok = await doSpend(cost, (coins) => setPet((p) => (p ? { ...p, coins, stats: { fullness: 60, happiness: 60, health: 60 }, updatedAt: Date.now() } : p)));
    if (ok) { setToast(`💊 ${pet.name} is back on its feet!`); setModal(null); }
  }

  // Уровень любого питомца игрока (активного — из level, остальных — из progress).
  function petLevel(id: string): number {
    if (!pet) return 1;
    if (id === pet.species) return pet.level;
    return pet.progress[id]?.level ?? 1;
  }

  // Скрестить двух выбранных питомцев → новый случайный (rare+). Phase 2: родителей (владение + уровень)
  // и исход проверяет/решает СЕРВЕР по леджеру; клиент не может подсунуть чужих родителей или фейкового пета.
  async function breed() {
    if (!pet || breedSel.length !== 2) return;
    if (!rewardsUnlocked) return setToast(`Connect & verify your wallet to spend ${SIL}`);
    if (Math.floor(pet.coins) < BREED_COST) return setToast(`Not enough ${SIL}`);
    const res = await petsBreed(breedSel);
    if ("error" in res) {
      if (typeof res.coins === "number") setCoins(res.coins);
      return setToast(res.error === "not enough PV" ? `Not enough ${SIL}` : res.error === "own all" ? "You own every duck! 🎉" : "Breeding failed — try again");
    }
    const won = PETS.find((p) => p.id === res.species);
    if (!won) return;
    setPet((p) => (p ? { ...p, coins: res.coins, ownedSpecies: [...p.ownedSpecies, won.id], updatedAt: Date.now() } : p));
    setBred({ id: won.id, rarity: won.rarity });
  }
  function closeBreed() {
    setModal(null);
    setBreedSel([]);
    setBred(null);
  }

  // Switch the active species. Each pet keeps its OWN progress (level/xp/stats/buffs):
  // the current pet's progress is snapshotted, and the target's saved progress is loaded
  // (a freshly-won pet has none yet → starts at level 1).
  function switchSpecies(id: string) {
    // Переключиться можно только на питомца, которым уже владеешь. Стартовый базовый выбран при
    // создании — остальные базовые остаются недоступными.
    if (!pet || !pet.ownedSpecies.includes(id) || id === pet.species) return;
    if (!pet.names[id]) { setNamePet(id); setPetNameInput(""); return; } // нового пета сначала надо назвать
    doSwitch(id, pet.names);
  }
  // Собственно переключение активного питомца (имя берём из карты names).
  function doSwitch(id: string, names: Record<string, string>) {
    if (!pet) return;
    playQwak(id); // здоровается голосом той утки, на которую переключились
    setToast(`Qwak! ${names[id]} is up 🦆`);

    const now = Date.now();
    // Снапшотим активного пета (включая надетые на него аксессуары), затем загружаем прогресс цели.
    const progress = { ...pet.progress, [pet.species]: { stats: pet.stats, xp: pet.xp, level: pet.level, buffs: pet.buffs, accessories: pet.accessories } };
    const saved = progress[id];
    const next = saved ?? { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: 1, buffs: [], accessories: [] };
    delete progress[id]; // it's the active pet now
    setPet({ ...pet, species: id as PetId, name: names[id], names, stats: next.stats, xp: next.xp, level: next.level, buffs: next.buffs, accessories: next.accessories ?? [], progress, updatedAt: now });
  }
  // Аварийное БЕСПЛАТНОЕ воскрешение: доступно, только когда ВСЕ питомцы мертвы (иначе soft-lock —
  // нечем зарабатывать/играть). Оживляем выбранного пета и делаем активным, но с уровнем на 1 меньше
  // (плата за бесплатность). Условие allDead исчезает после первого воскрешения → ровно один раз за раз.
  function freeReviveAll(species: string) {
    if (!pet || !allDead || !pet.ownedSpecies.includes(species)) return;
    const now = Date.now();
    // Снапшотим текущего активного (он тоже мёртв) в progress, если оживляем не его.
    const progress = { ...pet.progress };
    if (species !== pet.species) {
      progress[pet.species] = { stats: pet.stats, xp: pet.xp, level: pet.level, buffs: pet.buffs, accessories: pet.accessories };
    }
    const curLevel = species === pet.species ? pet.level : (progress[species]?.level ?? 1);
    const accessories = species === pet.species ? pet.accessories : (progress[species]?.accessories ?? []);
    const level = Math.max(1, curLevel - 1); // штраф −1 уровень
    delete progress[species]; // становится активным
    const name = pet.names[species] ?? pet.name;
    setPet({ ...pet, species: species as PetId, name, stats: { fullness: 60, happiness: 60, health: 60 }, xp: 0, level, buffs: [], accessories, progress, updatedAt: now });
    setToast(`💖 Free revive! ${name} is back at level ${level}`);
  }
  // Назвать нового пета и сразу выбрать его.
  function confirmPetName() {
    if (!pet || !namePet || !petNameInput.trim()) return;
    const names = { ...pet.names, [namePet]: petNameInput.trim() };
    doSwitch(namePet, names);
    setNamePet(null);
    setPetNameInput("");
  }

  // Equip / unequip an owned accessory. Only one per type (one cap, one leash, etc.).
  // Аксессуары привязаны к питомцу: надетый остаётся на нём при переключении и уходит с ним при продаже.
  // При надевании на активного пета аксессуар ПЕРЕНОСИТСЯ с другого пета (убираем из его progress),
  // чтобы один и тот же аксессуар не оказался сразу на двоих (без дублей).
  function toggleAccessory(id: string) {
    if (!pet) return;
    const acc = accById(id);
    if (!acc) return;
    const worn = pet.accessories.includes(id);
    if (worn) {
      setPet({ ...pet, accessories: pet.accessories.filter((a) => a !== id), updatedAt: Date.now() });
      return;
    }
    // Снимаем аксессуар того же типа с активного, добавляем этот.
    const sameType: string[] = ACCESSORIES.filter((a) => a.type === acc.type).map((a) => a.id);
    const accessories = [...pet.accessories.filter((a) => !sameType.includes(a)), id];
    // Переносим: убираем этот id у всех неактивных питомцев, если он был надет на ком-то из них.
    const progress = { ...pet.progress };
    for (const sp of Object.keys(progress)) {
      const on = progress[sp].accessories ?? [];
      if (on.includes(id)) progress[sp] = { ...progress[sp], accessories: on.filter((a) => a !== id) };
    }
    setPet({ ...pet, accessories, progress, updatedAt: Date.now() });
  }

  // Награды (daily/рулетка) — только для подключённого+верифицированного кошелька: тогда кулдаун
  // и баланс DC живут в облаке per-wallet, и абузер не сбросит их, очистив localStorage/создав
  // новый локальный «аккаунт» (для нового старта нужен реально новый кошелёк your wallet — это трение).
  const rewardsUnlocked = !!wallet && verified;
  const dailyReady = pet ? uiNow - pet.lastDaily >= DAILY_COOLDOWN : false;
  // Дейли начисляет СЕРВЕР (фиксированная сумма, кулдаун серверный → сброс очисткой localStorage не работает).
  async function claimDaily() {
    if (!pet || !dailyReady) return;
    if (!rewardsUnlocked) return setToast("Connect & verify your wallet to claim daily rewards");
    const res = await pvDaily();
    if ("error" in res) { if (typeof res.coins === "number") setCoins(res.coins); return setToast("Daily not ready yet"); }
    // Стрик держится, пока не пропущено больше одного полного окна между claim'ами (чисто визуальный счётчик).
    const now = Date.now();
    const kept = pet.lastDaily > 0 && now - pet.lastDaily <= DAILY_COOLDOWN * 2;
    const dailyStreak = kept ? pet.dailyStreak + 1 : 1;
    setPet((p) => (p ? { ...p, coins: res.coins, lastDaily: now, dailyStreak, updatedAt: now } : p));
    setToast(`Daily reward: +${res.credited} ${SIL}`);
    playDailySound();
  }

  // Купить зелье → в инвентарь зелий (не выпивается сразу). DC списывается на сервере.
  async function buyPotion(p: Potion) {
    if (!pet) return;
    const cost = price(p.cost);
    const ok = await doSpend(cost, (coins) => setPet((pp) => (pp ? { ...pp, coins, potionInv: { ...pp.potionInv, [p.id]: (pp.potionInv[p.id] ?? 0) + 1 } } : pp)));
    if (ok) setToast(`Bought ${p.label} ${p.emoji}`);
  }
  // Выпить зелье → активирует временный бафф (обновляет таймер, если такое уже активно).
  function drinkPotion(id: string) {
    if (!pet || (pet.potionInv[id] ?? 0) <= 0) return;
    const p = potionById(id);
    if (!p) return;
    const now = Date.now();
    const potions = [...pet.potions.filter((x) => x.id !== id && x.expiresAt > now), { id, expiresAt: now + p.durationMs }];
    setPet({ ...pet, potionInv: { ...pet.potionInv, [id]: pet.potionInv[id] - 1 }, potions, updatedAt: now });
    setToast(`${p.emoji} ${p.label} active — ${p.desc}`);
  }

  // Забрать награду за квест: создаём заявку (сервер), квест становится перечёркнутым.
  // Награду (реальный ETH) админ отправляет вручную из казны, посмотрев заявки в админ-панели.
  async function claimQuest(id: string, reward: number) {
    if (!pet || pet.questDone.includes(id)) return;
    if (!wallet || !isCloudEnabled()) return setToast("Connect your wallet to claim quest rewards");
    if (!verified) return setToast("Verify your wallet first (wallet menu)");
    const status = await createQuestClaim(wallet, id);
    if (status === "error") return setToast("Couldn't submit claim — try again");
    if (status === "taken") {
      fetchClaimedQuestIds().then((map) => { if (map) setClaimedQuests(map); });
      return setToast("Too late — someone else already claimed this quest");
    }
    const updated = { ...pet, questDone: [...pet.questDone, id], updatedAt: Date.now() };
    setPet(updated);
    saveCloudSave(wallet, updated);
    setClaimedQuests((m) => ({ ...m, [id]: wallet }));
    setToast(`✅ Quest reward requested: ${reward} ETH — sent after admin review`);
  }
  // Закрыть (скрыть) квест локально. Общее для всех игроков закрытие — с бэкендом.
  function dismissQuest(id: string) {
    if (!pet || pet.questClaimed.includes(id)) return;
    setPet({ ...pet, questClaimed: [...pet.questClaimed, id] });
  }

  // Выставить своего питомца на продажу. Ключевая механика: листинг = ЭСКРОУ — пета сразу
  // изымаем из инвентаря продавца (локально + сразу в облако), его данные хранит сам лот.
  // Так автосейв продавца не «вернёт» проданного пета. Активного пета выставлять нельзя.
  async function listPet() {
    if (!pet) return;
    const species = listSpecies;
    const askPrice = parseFloat(listPrice);
    if (!species || !pet.ownedSpecies.includes(species)) return setToast("Pick a duck to list");
    if (species === pet.species) return setToast("Switch to another duck before listing this one");
    if (!(askPrice > 0)) return setToast("Enter a valid ETH price");
    if (wallet && isCloudEnabled() && !verified) return setToast("Verify your wallet first (wallet menu)");
    if (listBusy) return; // защита от двойного клика (иначе один пет уйдёт в два лота)
    setListBusy(true);
    const lvl = pet.progress[species]?.level ?? 1;
    const buffs = pet.progress[species]?.buffs ?? [];
    const accessories = pet.progress[species]?.accessories ?? []; // надетые на пета аксессуары — уходят с ним
    const name = pet.names[species] ?? "";
    const id = `l${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    setListSpecies("");
    setListPrice("");
    // Изымаем пета из инвентаря продавца (species остаётся в names). Аксессуары пета тоже покидают продавца
    // (убираем их из ownedAccessories — они переходят к покупателю вместе с петом).
    const progress = { ...pet.progress };
    delete progress[species];
    const base = { ...pet, ownedSpecies: pet.ownedSpecies.filter((s) => s !== species), ownedAccessories: pet.ownedAccessories.filter((a) => !accessories.includes(a)), progress, updatedAt: Date.now() };
    if (wallet && isCloudEnabled()) {
      // Phase 2: эскроу делает СЕРВЕР — pet_take забирает пета из леджера и создаёт лот. Не владеешь по
      // леджеру (подделанный сейв) → лот не создастся, продать за ETH нельзя. Уровень/имя/аксессуары — витрина.
      const res = await petsList(species, askPrice, lvl, buffs, name, accessories);
      if ("error" in res) {
        setListBusy(false);
        return setToast(res.error === "you don't own this duck" ? "You don't own this duck" : "Couldn't list — try again");
      }
      // Успех → обновляем локальное зеркало (убираем вид + его аксессуары), чтобы автосейв их не вернул.
      setPet(base);
      saveCloudSave(wallet, base);
      fetchListings("sale").then(setMarketListings);
    } else {
      // Локальный лот (без облака) — виден только тебе.
      setPet({ ...base, listings: [...base.listings, { id, kind: "sale", species, level: lvl, buffs, accessories, price: askPrice, createdAt: Date.now() } as MarketListing] });
    }
    setToast("🏷️ Duck listed for sale");
    setListBusy(false);
  }

  // Вернуть эскроу-пета продавцу (в ownedSpecies/progress/names) вместе с его аксессуарами.
  function restorePet(species: string, level: number, buffs: { kind: BuffKind; expiresAt: number }[], accessories: string[], name?: string) {
    if (!pet || pet.ownedSpecies.includes(species)) return;
    const nm = name || pet.names[species];
    // Как и в applyBought: снять эти аксессуары со всех, на ком они уже могли быть надеты, прежде
    // чем "надеть" их обратно на возвращаемого пета — иначе id может задвоиться.
    const { activeAccessories, progress: strippedProgress } = stripAccessoriesElsewhere(pet.accessories, pet.progress, accessories, species);
    const updated = {
      ...pet,
      accessories: activeAccessories,
      ownedSpecies: [...pet.ownedSpecies, species],
      ownedAccessories: accessories.length ? Array.from(new Set([...pet.ownedAccessories, ...accessories])) : pet.ownedAccessories,
      progress: { ...strippedProgress, [species]: { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: level || 1, buffs: buffs ?? [], accessories } },
      names: nm ? { ...pet.names, [species]: nm } : pet.names,
      updatedAt: Date.now(),
    };
    setPet(updated);
    if (wallet && isCloudEnabled()) saveCloudSave(wallet, updated);
  }

  // Снять свой лот с продажи и вернуть пета. Если лот уже куплен — вернуть нечего.
  async function cancelListing(id: string) {
    if (!pet) return;
    if (wallet && isCloudEnabled()) {
      // Phase 2: сервер удаляет лот и возвращает пета в леджер (pet_grant). restored=false → уже куплен.
      const res = await petsCancel(id);
      fetchListings("sale").then(setMarketListings);
      if ("error" in res) return setToast("Couldn't cancel — try again");
      if (res.restored && res.species) {
        restorePet(res.species, res.level ?? 1, res.buffs ?? [], res.accessories ?? [], res.name ?? undefined);
      } else {
        setToast("This duck was already sold");
      }
    } else {
      // Локальный лот: снимаем лот И возвращаем пета одним обновлением (два setPet затёрли бы друг друга).
      const lot = pet.listings.find((l) => l.id === id);
      const listings = pet.listings.filter((l) => l.id !== id);
      if (lot && !pet.ownedSpecies.includes(lot.species)) {
        const acc = lot.accessories ?? [];
        setPet({
          ...pet,
          listings,
          ownedSpecies: [...pet.ownedSpecies, lot.species],
          ownedAccessories: acc.length ? Array.from(new Set([...pet.ownedAccessories, ...acc])) : pet.ownedAccessories,
          progress: { ...pet.progress, [lot.species]: { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: lot.level || 1, buffs: lot.buffs ?? [], accessories: acc } },
          updatedAt: Date.now(),
        });
      } else {
        setPet({ ...pet, listings });
      }
    }
  }

  // Купить пета с рынка игроков за реальный ETH. Оплата → processPurchase (сохранит подпись и
  // повторит подтверждение, если сеть ещё не видит tx — деньги не потеряются).
  async function buyPet(listing: { id: string; species: string; price: number; seller: string }) {
    if (!wallet) return setToast("Connect wallet first");
    if (!verified) return setToast("Verify your wallet first (wallet menu)");
    if (listing.seller === wallet) return setToast("That's your own listing");
    if (pet && pet.ownedSpecies.includes(listing.species)) return setToast("You already own this duck");
    const label = PETS.find((p) => p.id === listing.species)?.label ?? "pet";
    setBuying(true);
    // Казна ещё не настроена (нулевой адрес) — платить некуда. Явное сообщение вместо
    // «Payment cancelled», чтобы не выглядело, будто игрок сам отменил оплату.
    if (!isTreasuryConfigured()) { setBuying(false); return setToast("Payments are not available yet"); }
    setToast("Confirm the payment in your wallet…");
    try {
      const paid = await sendPayment(listing.price);
      if (!paid) { setBuying(false); return setToast("Payment cancelled"); }
      setToast("Verifying payment on-chain…");
      await processPurchase({ kind: "sale", sig: paid.signature, wallet: paid.payer, refId: listing.id, species: listing.species, label, ts: Date.now() });
    } catch {
      setToast("Purchase failed");
    }
    setBuying(false);
  }

  // Купить эксклюзивного пета у казны за реальный ETH (та же схема с повтором подтверждения).
  async function buyExclusive(ex: Exclusive) {
    if (!wallet) return setToast("Connect wallet first");
    if (!verified) return setToast("Verify your wallet first (wallet menu)");
    if (pet && pet.ownedSpecies.includes(ex.species)) return setToast("You already own this duck");
    const label = PETS.find((p) => p.id === ex.species)?.label ?? "pet";
    setBuying(true);
    // Казна ещё не настроена (нулевой адрес) — платить некуда. Явное сообщение вместо
    // «Payment cancelled», чтобы не выглядело, будто игрок сам отменил оплату.
    if (!isTreasuryConfigured()) { setBuying(false); return setToast("Payments are not available yet"); }
    setToast("Confirm the payment in your wallet…");
    try {
      const paid = await sendPayment(ex.price);
      if (!paid) { setBuying(false); return setToast("Payment cancelled"); }
      setToast("Verifying payment on-chain…");
      await processPurchase({ kind: "exclusive", sig: paid.signature, wallet: paid.payer, refId: ex.id, species: ex.species, label, ts: Date.now() });
    } catch {
      setToast("Purchase failed");
    }
    setBuying(false);
  }

  // Админ: добавить эксклюзивного пета на витрину (лимитированный тираж).
  async function addExclusive() {
    if (!isAdmin) return;
    if (!verified) return setToast("Verify your admin wallet first");
    const species = exSpecies;
    const price = parseFloat(exPrice);
    const stock = Math.max(1, parseInt(exStock) || 1);
    if (!species) return setToast("Pick a species");
    if (!(price > 0)) return setToast("Enter a valid ETH price");
    const id = `x${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const ok = await createExclusive({ id, species, name: "", price, stock, sold: 0, active: true });
    if (ok) {
      setToast("✨ Exclusive added");
      setExSpecies("");
      setExPrice("");
      setExStock("1");
      fetchExclusives().then(setExclusives);
    } else {
      setToast("Failed to add exclusive");
    }
  }

  // Админ: убрать эксклюзив с витрины.
  async function removeExclusive(id: string) {
    if (!isAdmin) return;
    const ok = await deleteExclusive(id);
    if (ok) fetchExclusives().then(setExclusives);
    else setToast("Failed to remove");
  }

  const pickedInfo = PETS.find((p) => p.id === picked);
  // Базовые (обычные) питомцы не умирают — экран смерти только для rare+ питомцев.
  // Смерть теперь возможна у ВСЕХ (включая базовых — от голода). Мёртвый пет заморожен → экран воскрешения.
  const dead = !!pet && pet.stats.health <= 0;
  const reviveCost = pet ? reviveCostFor(pet.level, pet.species) : 0;
  // Все питомцы игрока мертвы → аварийное БЕСПЛАТНОЕ воскрешение одного на выбор (иначе soft-lock).
  // Здоровье активного вида в pet.stats, остальных — в progress. Нет записи (не гидратирован) = считаем живым.
  const allDead = !!pet && pet.ownedSpecies.length > 0 && pet.ownedSpecies.every((sp) => (sp === pet.species ? pet.stats.health : (pet.progress[sp]?.stats.health ?? 100)) <= 0);
  const cap = pet ? statCap(pet.level) : 100; // макс fullness/happiness (растёт с уровнем)
  // Питомцы игрока уровня BREED_LEVEL+ — кандидаты в родители для скрещивания.
  const breedEligible = pet ? pet.ownedSpecies.filter((id) => petLevel(id) >= BREED_LEVEL) : [];
  // Активные эффекты зелий (для показа ставки Sil/мин и силы арены).
  const potEff = pet ? potionEffects(pet.potions, Date.now()) : { sil: 0, power: 0, decay: 0, xp: 0, daily: 0 };
  // Пассив теперь серверный: база × множитель уровня (капнут ×3), без бонусов аксессуаров/зелий.
  const silMult = pet ? Math.min(levelSilMult(pet.level), 3) : 1;
  const silPerMin = pet ? BASE_SIL_PER_MIN * silMult : 0;
  // Прогресс квеста по его метрике (выводится из полей сейва).
  function questValue(metric: string): number {
    if (!pet) return 0;
    if (metric === "battleWins") return pet.battleWins;
    if (metric === "level") return pet.level;
    if (metric === "bestScore") return pet.bestScore;
    if (metric === "ownedPets") return pet.ownedSpecies.length;
    if (metric === "coins") return Math.floor(pet.coins);
    return 0;
  }
  // Открытые квесты (ещё не забраны и не скрыты) и забранные (перечёркнутые, ждут выплаты).
  const activeQuests = pet ? QUESTS.filter((q) => !pet.questClaimed.includes(q.id) && !pet.questDone.includes(q.id) && !claimedQuests[q.id]) : [];
  const doneQuests = pet ? QUESTS.filter((q) => pet.questDone.includes(q.id) && !pet.questClaimed.includes(q.id)) : [];
  // Закрыт ДРУГИМ игроком — я его не заявлял, но он больше недоступен и я вижу, кто его забрал.
  const closedQuests = pet ? QUESTS.filter((q) => claimedQuests[q.id] && claimedQuests[q.id] !== wallet && !pet.questDone.includes(q.id) && !pet.questClaimed.includes(q.id)) : [];

  function mood(s: Stats): string {
    if (s.health <= 0) return "is very sick… take care of me!";
    if (s.fullness <= 20) return "is hungry 🍖";
    if (s.happiness <= 20) return "is bored 🥺";
    if (s.fullness >= 70 && s.happiness >= 70) return "is happy and healthy! 💛";
    return "is doing okay.";
  }

  function dailyLeft(): string {
    if (!pet) return "";
    const ms = pet.lastDaily + DAILY_COOLDOWN - uiNow;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }

  // Доля прошедшего времени до следующей daily-награды (0..100) — для полоски прогресса на кнопке.
  function dailyProgressPct(): number {
    if (!pet) return 0;
    const elapsed = uiNow - pet.lastDaily;
    return Math.max(0, Math.min(100, (elapsed / DAILY_COOLDOWN) * 100));
  }

  // Inventory entries the pet actually owns (qty > 0).
  const ownedItems = pet
    ? FOODS.filter((f) => (pet.inventory[f.id] ?? 0) > 0).map((f) => ({ food: f, qty: pet.inventory[f.id] }))
    : [];
  const ownedAcc = pet ? ACCESSORIES.filter((a) => pet.ownedAccessories.includes(a.id)) : [];
  // Питомцы для коллекции/переключения: только выбиваемые из сундука (rare и выше).
  // Стартовые обычные (dog/cat/hamster) в этот список не попадают.
  const collectiblePets = PETS.filter((p) => p.rarity !== "common");
  // Базовые питомцы, которыми игрок уже владеет — их тоже показываем в списке переключения.
  // Все базовые питомцы (dog/cat/hamster) всегда доступны для переключения — не только стартовый.
  const basePets = PETS.filter((p) => p.rarity === "common");

  // Preview data: the pool of possible drops + per-item chance for the clicked chest.
  const previewData = (() => {
    if (!preview) return null;
    const odds = preview.chest.odds as Partial<Record<Rarity, number>>;
    const all = (preview.kind === "food" ? FOODS : preview.kind === "accessory" ? ACCESSORIES : PETS) as readonly PoolItem[];
    const pool = all.filter((i) => (odds[i.rarity] ?? 0) > 0);
    const counts: Partial<Record<Rarity, number>> = {};
    pool.forEach((i) => { counts[i.rarity] = (counts[i.rarity] ?? 0) + 1; });
    const chanceOf = (i: PoolItem) => ((odds[i.rarity] ?? 0) / (counts[i.rarity] || 1));
    return { pool, chanceOf };
  })();

  // Подсказка для предмета в превью сундука: те же характеристики, что и в инвентаре.
  function chestItemTitle(i: PoolItem): string {
    if (!preview) return i.label;
    if (preview.kind === "food") {
      const f = FOODS.find((x) => x.id === i.id);
      return f ? foodTitle(f) : i.label;
    }
    if (preview.kind === "accessory") {
      const a = accById(i.id);
      const crit = accCrit(i.rarity);
      const critTxt = crit ? ` · 💥 ${Math.round(crit.chance * 100)}% crit` : "";
      return `${RARITY[i.rarity].label} · ${a ? accDesc(a.type, i.rarity) : ""} · ⚔️+${accPower(i.rarity)} ❤️+${accHp(i.rarity)}${critTxt}`;
    }
    // pet
    const perk = SPECIES_PERK[i.id]?.label;
    return `${RARITY[i.rarity].label}${perk ? ` · ✨ ${perk}` : " · Starter duck"}`;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Duckverse</span>
          <span className="tagline">your onchain duck world</span>
        </div>
        <div className="topbar-right">
          <div className="wallet-wrap">
            {wallet ? (
              <button className="wallet-btn wallet-on" onClick={() => setWalletMenu((v) => !v)} title={verified ? "Verified" : "Connected (not verified)"}>
                <span className={"wallet-dot" + (verified ? "" : " wallet-dot-unverified")} /> {shortAddress(wallet)}
              </button>
            ) : (
              <button className="wallet-btn" onClick={openWalletPicker}>Connect wallet</button>
            )}
            {wallet && walletMenu && (
              <>
                <div className="wallet-scrim" onClick={() => setWalletMenu(false)} />
                <div className="wallet-menu">
                  <div className="wallet-addr" title={wallet}>{shortAddress(wallet)}</div>
                  {verified ? (
                    <div className="wallet-verified">✓ Verified</div>
                  ) : (
                    <button className="wallet-menu-btn" onClick={() => verifyWallet()}>🔏 Verify wallet</button>
                  )}
                  {isAdmin && (
                    <button className="wallet-menu-btn" onClick={() => { setWalletMenu(false); setModal("admin"); }}>🛠️ Sell requests</button>
                  )}
                  <button className="wallet-menu-btn" onClick={() => { navigator.clipboard?.writeText(wallet); setToast("Address copied"); setWalletMenu(false); }}>Copy address</button>
                  <button className="wallet-menu-btn wallet-disc" onClick={disconnectWallet}>Disconnect</button>
                </div>
              </>
            )}
          </div>
          {pet && (
            <span className="balance-pill" title={`+${+silPerMin.toFixed(2)} ${SIL}/min passive · Lv ${pet.level} ×${silMult.toFixed(1)}`}>
              <Coin />
              <span className={"balance-amt" + (coinsFx ? " balance-amt-fx" : "")}>{Math.floor(pet.coins).toLocaleString()}</span>
              <span className="balance-cur">{SIL}</span>
              <span className="rate">+{+silPerMin.toFixed(2)}/min</span>
            </span>
          )}
          {pet && (
            <button className="buy-sil-btn" title="Exchange DC ↔ ETH" onClick={() => setModal("buysil")}>+</button>
          )}
          {pet && (
            <button className="market-btn" title="Marketplace — trade items for ETH" onClick={() => setModal("market")}>🛍️ Market</button>
          )}
        </div>
      </header>

      {cloudLoading && !pet ? (
        // ===== Cloud sync loading =====
        <main className="stage">
          <h1 className="title">Syncing…</h1>
          <p className="subtitle">Loading your duck from the cloud ☁️</p>
        </main>
      ) : !pet ? (
        // ===== Create screen =====
        <main className="stage">
          <h1 className="title">Choose your duck</h1>
          <p className="subtitle">Who will you raise?</p>

          <div className="pet-grid">
            {STARTER_PETS.map((p) => (
              <button
                key={p.id}
                className={"pet-card" + (picked === p.id ? " pet-card-on" : "")}
                onClick={() => { setPicked(p.id); playQwak(p.id); }}
              >
                <span className="pet-emoji"><PetArt species={p.id} size={56} /></span>
                <span className="pet-label">{p.label}</span>
              </button>
            ))}
          </div>

          {picked && (
            <div className="name-row">
              <input
                className="name-input"
                placeholder={`Name your ${pickedInfo?.label.toLowerCase()}`}
                value={name}
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createPet()}
              />
              <button className="btn btn-primary" disabled={!name.trim()} onClick={createPet}>
                Create
              </button>
            </div>
          )}
        </main>
      ) : (
        // ===== Pet screen =====
        <main className="stage">
          <div className={"pet-view" + (dead ? " pet-view-dead" : "")}>
            {dead ? (
              // ===== Death screen =====
              <div className="death-screen">
                <div className="death-art">
                  <span className="death-art-pet"><PetArt species={pet.species} size={120} /></span>
                  <span className="death-skull">💀</span>
                </div>
                <h2 className="death-title">Fainted</h2>
                <p className="death-name">{pet.name}</p>
                <p className="subtitle">{pet.name} collapsed from neglect… 💔</p>
                <div className="death-revive">
                  <span className="death-cost">💊 Revive medicine — {reviveCost} {SIL}</span>
                  <button className="btn btn-primary" disabled={pet.coins < reviveCost} onClick={revivePet}>
                    {pet.coins >= reviveCost ? `💊 Revive ${pet.name}` : `Need ${reviveCost} ${SIL}`}
                  </button>
                </div>
                {allDead && (
                  // Все питомцы мертвы — аварийное бесплатное воскрешение одного на выбор (уровень −1).
                  <div className="death-revive" style={{ marginTop: 12 }}>
                    <span className="death-cost">💖 All ducks fainted — revive one for FREE (level −1)</span>
                    <div className="actions" style={{ flexWrap: "wrap", justifyContent: "center" }}>
                      {pet.ownedSpecies.map((sp) => {
                        const info = PETS.find((p) => p.id === sp)!;
                        const lvl = sp === pet.species ? pet.level : (pet.progress[sp]?.level ?? 1);
                        return (
                          <button key={sp} className="btn btn-secondary" onClick={() => freeReviveAll(sp)}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <PetArt species={sp} size={22} />
                              {pet.names[sp] ?? info.label} → Lv {Math.max(1, lvl - 1)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="actions">
                  <button className="btn btn-secondary" onClick={() => setModal("shop")}>🛒 Shop</button>
                  <button className="btn btn-secondary" onClick={() => setModal("pets")}>🔄 Switch duck</button>
                </div>
              </div>
            ) : (
              <>
                <div className="pet-stage" key={pet.species}>
                  <span className="pet-glow" style={{ background: RARITY[PETS.find((p) => p.id === pet.species)?.rarity ?? "common"].color }} />
                  <button className={"pet-emoji-big pet-emoji-btn" + (levelUpFx ? " pet-emoji-levelup" : "")} onClick={() => { setPetMenu(true); playQwak(pet.species); }} title={`Interact with ${pet.name}`}>
                    <PetArt species={pet.species} size={110} />
                  </button>
                  {levelUpFx && (
                    <div className="level-up-fx">
                      <span className="level-up-text">LEVEL UP!</span>
                    </div>
                  )}
                </div>

                <div className="slots">
                  {SLOTS.map((s) => {
                    const equipped = ACCESSORIES.find((a) => a.type === s.type && pet.accessories.includes(a.id));
                    return (
                      <button
                        key={s.type}
                        className={"slot" + (equipped ? " slot-filled" : " slot-empty")}
                        onClick={() => setAccPicker(s.type)}
                        title={equipped ? equipped.label : `Empty ${s.label} slot`}
                      >
                        {/* key меняется только когда в слот попадает НОВЫЙ аксессуар — ремаунт запускает CSS-анимацию появления */}
                        <span key={equipped ? equipped.id : `empty-${s.type}`} className={"slot-emoji" + (equipped ? " slot-emoji-pop" : "")}>
                          {equipped ? equipped.emoji : s.ghost}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <h2 className="pet-name">{pet.name}</h2>
                <p className="subtitle">{pet.name} {mood(pet.stats)}</p>
                {SPECIES_PERK[pet.species] && <p className="perk-line">✨ {SPECIES_PERK[pet.species].label}</p>}

                <div className="stats">
                  <StatBar label="Fullness" value={pet.stats.fullness} max={cap} color="#ffb020" />
                  <StatBar label="Happiness" value={pet.stats.happiness} max={cap} color="#ff7ac8" />
                  <StatBar label="Health" value={pet.stats.health} color="#1ad17a" warnLow />
                  {/* XP / level */}
                  <div className="stat">
                    <div className="stat-head">
                      <span>Level {pet.level}</span>
                      <span className="stat-val">
                        {Math.floor(pet.xp)} / {xpForLevel(pet.level)} XP
                        {xpGainFx !== null && <span className="xp-gain-fx"> +{xpGainFx} XP</span>}
                      </span>
                    </div>
                    <div className="stat-track">
                      <div className={"stat-fill" + (xpGainFx !== null ? " stat-fill-xpflash" : "")} style={{ width: `${(pet.xp / xpForLevel(pet.level)) * 100}%`, background: "#7aa2ff" }} />
                    </div>
                  </div>
                </div>

                {(() => {
                  const active = pet.buffs.filter((b) => b.expiresAt > uiNow);
                  if (active.length === 0) return null;
                  const chip = (b: { kind: BuffKind; expiresAt: number }) => {
                    const m = BUFFS[b.kind];
                    const left = Math.max(0, b.expiresAt - uiNow);
                    const mm = Math.floor(left / 60000);
                    const ss = Math.floor((left % 60000) / 1000);
                    const pct = Math.max(0, Math.min(100, (left / m.durationMs) * 100));
                    const expiringSoon = left <= 10000;
                    return (
                      <span key={b.kind} className={"buff-chip" + (expiringSoon ? " buff-chip-warn" : "")} title={`${m.label}`}>
                        <span className="buff-ring" style={{ background: `conic-gradient(var(--accent) ${pct}%, rgba(255,255,255,0.18) 0)` }}>
                          <span className="buff-ring-inner">{m.emoji}</span>
                        </span>
                        {m.label} {mm}:{String(ss).padStart(2, "0")}
                      </span>
                    );
                  };
                  // До 2 баффов — показываем сразу; больше — прячем под стрелку.
                  if (active.length <= 2) return <div className="buffs">{active.map(chip)}</div>;
                  return (
                    <div className="buffs-wrap">
                      <button className="buffs-arrow" onClick={() => setShowBuffs((s) => !s)}>
                        ✨ {active.length} buffs <span className={"buffs-caret" + (showBuffs ? " open" : "")}>▾</span>
                      </button>
                      {showBuffs && <div className="buff-pop">{active.map(chip)}</div>}
                    </div>
                  );
                })()}

                <div className="actions">
                  <button className="btn btn-primary" onClick={() => setModal("inventory")}>🎒 Inventory</button>
                  <button className="btn btn-secondary" onClick={() => setModal("shop")}>🛒 Shop</button>
                  <button className="btn btn-secondary" onClick={() => setModal("playmenu")}>🎾 Play</button>
                  <button className="btn btn-secondary" onClick={() => rewardsUnlocked ? setModal("roulette") : setToast("Connect & verify your wallet to play the roulette")}>🎰 Roulette</button>
                  <button className="btn btn-secondary" onClick={() => setModal("breed")}>🧬 Breed</button>
                  <button className="btn btn-secondary" onClick={() => setModal("leaderboard")}>🏆 Ranks</button>
                </div>

                <button className={"btn btn-daily" + (dailyReady && rewardsUnlocked ? " btn-daily-ready" : "")} disabled={!dailyReady || !rewardsUnlocked} onClick={claimDaily} title={!rewardsUnlocked ? "Connect & verify your wallet to claim daily rewards" : undefined}>
                  {rewardsUnlocked && !dailyReady && (
                    <span className="btn-daily-fill" style={{ width: `${dailyProgressPct()}%` }} />
                  )}
                  <span className="btn-daily-label">
                    {!rewardsUnlocked ? "🎁 Connect wallet for daily" : dailyReady ? `🎁 Claim daily +${DAILY_REWARD} ${SIL}` : `🎁 Daily in ${dailyLeft()}`}
                    {rewardsUnlocked && pet.dailyStreak >= 2 && <span className="daily-streak"> · 🔥 {pet.dailyStreak} streak</span>}
                  </span>
                </button>
              </>
            )}
          </div>
        </main>
      )}

      <footer className="footer">Duckverse · made on Robinhood Chain · Microduck by Pollen Robotics</footer>

      {/* ===== Social links (bottom-left) ===== */}
      <div className="social-bar">
        <a className="social-btn" href={LINK_TWITTER} target="_blank" rel="noreferrer" title="X (Twitter)" aria-label="X">𝕏</a>
        <button className="social-btn social-pv" title="$DC on Pons Family" onClick={() => setModal("pumpfun")}>DC</button>
      </div>

      {/* ===== Quests (bottom-right, collapsible) ===== */}
      {pet && !dead && !modal && !petMenu && (activeQuests.length > 0 || doneQuests.length > 0 || closedQuests.length > 0) && (
        <div className={"quest-panel" + (questsOpen ? "" : " quest-panel-closed")}>
          <button className="quest-head" onClick={() => setQuestsOpen((o) => !o)} title={questsOpen ? "Hide quests" : "Show quests"}>
            <span>📋 Quests ({activeQuests.length})</span>
            <span className={"quest-caret" + (questsOpen ? " open" : "")}>▾</span>
          </button>
          {questsOpen && activeQuests.map((q) => {
            const val = questValue(q.metric);
            const done = val >= q.goal;
            const pct = Math.min(100, (val / q.goal) * 100);
            return (
              <div key={q.id} className="quest-row">
                <div className="quest-top">
                  <span className="quest-label">{q.emoji} {q.label}</span>
                  <button className="quest-x" onClick={() => dismissQuest(q.id)} title="Hide quest">✕</button>
                </div>
                {done ? (
                  <button className="quest-claim" onClick={() => claimQuest(q.id, q.reward)}>✅ Claim {q.reward} ETH</button>
                ) : (
                  <>
                    <div className="quest-track"><div className="quest-fill" style={{ width: `${pct}%` }} /></div>
                    <div className="quest-prog">{Math.min(val, q.goal).toLocaleString()} / {q.goal.toLocaleString()} · {q.reward} ETH</div>
                  </>
                )}
              </div>
            );
          })}
          {/* Забранные квесты: перечёркнуты, ждут ручной выплаты ETH от админа. Показываем твой кошелёк. */}
          {questsOpen && doneQuests.map((q) => (
            <div key={q.id} className="quest-row quest-row-done">
              <div className="quest-top">
                <span className="quest-label quest-label-done">{q.emoji} {q.label}</span>
                <button className="quest-x" onClick={() => dismissQuest(q.id)} title="Hide">✕</button>
              </div>
              <div className="quest-prog">✅ Reward {q.reward} ETH — awaiting payout</div>
              {wallet && (
                <button
                  className="quest-wallet"
                  title="Copy your wallet (reward is sent here)"
                  onClick={() => { navigator.clipboard?.writeText(wallet); setToast("Address copied"); }}
                >
                  📋 {shortAddress(wallet)}
                </button>
              )}
            </div>
          ))}
          {/* Закрыт другим игроком: они заявили награду первыми — показываем кем, для ясности. */}
          {questsOpen && closedQuests.map((q) => (
            <div key={q.id} className="quest-row quest-row-done">
              <div className="quest-top">
                <span className="quest-label quest-label-done">{q.emoji} {q.label}</span>
                <button className="quest-x" onClick={() => dismissQuest(q.id)} title="Hide">✕</button>
              </div>
              <div className="quest-prog">🔒 Claimed by {shortAddress(claimedQuests[q.id])} — quest closed</div>
            </div>
          ))}
        </div>
      )}

      {/* ===== Shop ===== */}
      {modal === "shop" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Shop</h3>
              <span className="coins"><Coin /> {Math.floor(pet.coins)} {SIL}</span>
            </div>

            <div className="section-label">Medicine</div>
            <div className="shop-list">
              <div className="shop-item shop-item-rare" title="Revive a fainted duck">
                <span className="shop-emoji">💊</span>
                <div className="shop-info">
                  <span className="shop-name">Revive Potion</span>
                  <span className="shop-effect">{dead ? `Bring ${pet.name} back to life` : "Only works when your duck has fainted"}</span>
                </div>
                <button className="btn btn-primary btn-buy" disabled={!dead || pet.coins < reviveCost} onClick={revivePet}>
                  <Coin /> {reviveCost}
                </button>
              </div>
            </div>

            <div className="section-label">Food chests</div>
            <div className="chest-row">
              {FOOD_CHESTS.map((c) => (
                <button key={c.id} className="chest-card" onClick={() => setPreview({ kind: "food", chest: c })}>
                  <span className="chest-emoji">{c.emoji}</span>
                  <span className="chest-name" style={{ color: RARITY[bestTier(c.odds)].color }}>{c.label}</span>
                </button>
              ))}
            </div>

            <div className="section-label">Accessory chests</div>
            <div className="chest-row">
              {ACC_CHESTS.map((c) => (
                <button key={c.id} className="chest-card" onClick={() => setPreview({ kind: "accessory", chest: c })}>
                  <span className="chest-emoji">{c.emoji}</span>
                  <span className="chest-name" style={{ color: RARITY[bestTier(c.odds)].color }}>{c.label}</span>
                </button>
              ))}
            </div>

            <div className="section-label">Duck chests</div>
            <div className="chest-row">
              {PET_CHESTS.map((c) => (
                <button key={c.id} className="chest-card" onClick={() => setPreview({ kind: "pet", chest: c })}>
                  <span className="chest-emoji">{c.emoji}</span>
                  <span className="chest-name" style={{ color: RARITY[bestTier(c.odds)].color }}>{c.label}</span>
                </button>
              ))}
            </div>

            <div className="section-label">Food</div>
            <div className="shop-list">
              {FOODS.map((f) => (
                <div className={"shop-item" + (f.rarity !== "common" ? " shop-item-rare" : "")} key={f.id} title={foodTitle(f)}>
                  <span className="shop-emoji">{f.emoji}</span>
                  <div className="shop-info">
                    <span className="shop-name">
                      {f.label}
                      {f.rarity !== "common" && (
                        <span className="rare-badge" style={{ background: RARITY[f.rarity].color, color: "#1a1205" }}>
                          {RARITY[f.rarity].label}
                        </span>
                      )}
                    </span>
                    <span className="shop-effect">
                      +{f.fullness} fullness{f.happiness ? ` · +${f.happiness} happy` : ""}
                    </span>
                  </div>
                  <button className="btn btn-primary btn-buy" disabled={pet.coins < price(f.cost)} onClick={() => buyFood(f)}>
                    <Coin /> {price(f.cost)}
                  </button>
                </div>
              ))}
            </div>

            <div className="section-label">Potions — temporary boosts</div>
            <div className="shop-list">
              {POTIONS.map((p) => (
                <div className="shop-item shop-item-rare" key={p.id} title={potionTitle(p)}>
                  <span className="shop-emoji">{p.emoji}</span>
                  <div className="shop-info">
                    <span className="shop-name">{p.label}</span>
                    <span className="shop-effect">{p.desc} · {Math.round(p.durationMs / 60000)}m</span>
                  </div>
                  <button className="btn btn-primary btn-buy" disabled={pet.coins < price(p.cost)} onClick={() => buyPotion(p)}>
                    <Coin /> {price(p.cost)}
                  </button>
                </div>
              ))}
            </div>

            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Potions (drink) ===== */}
      {modal === "potions" && pet && (() => {
        const now = Date.now();
        const active = pet.potions.filter((x) => x.expiresAt > now);
        const owned = POTIONS.filter((p) => (pet.potionInv[p.id] ?? 0) > 0);
        return (
          <div className="scrim" onClick={() => setModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>🧪 Potions</h3>
                <span className="coins"><Coin /> {Math.floor(pet.coins)} {SIL}</span>
              </div>
              <p className="subtitle" style={{ marginTop: -4 }}>Drink potions for temporary boosts. Buy more in the Shop 🛒</p>

              {active.length > 0 && (
                <>
                  <div className="section-label">Active</div>
                  <div className="buffs">
                    {active.map((a) => {
                      const p = potionById(a.id);
                      if (!p) return null;
                      const left = Math.max(0, a.expiresAt - now);
                      const mm = Math.floor(left / 60000);
                      const ss = Math.floor((left % 60000) / 1000);
                      return <span key={a.id} className="buff-chip" title={p.desc}>{p.emoji} {p.desc} {mm}:{String(ss).padStart(2, "0")}</span>;
                    })}
                  </div>
                </>
              )}

              <div className="section-label">Your potions</div>
              {owned.length === 0 ? (
                <p className="empty">No potions yet — buy some in the Shop 🛒</p>
              ) : (
                <div className="inv-grid">
                  {owned.map((p) => (
                    <button key={p.id} className="inv-item inv-item-rare" onClick={() => drinkPotion(p.id)} title={potionTitle(p)}>
                      <span className="inv-qty">×{pet.potionInv[p.id]}</span>
                      <span className="inv-emoji">{p.emoji}</span>
                      <span className="inv-name">{p.label}</span>
                      <span className="inv-feed">Drink</span>
                    </button>
                  ))}
                </div>
              )}
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* ===== Inventory ===== */}
      {modal === "inventory" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Inventory</h3>
              <span className="coins"><Coin /> {Math.floor(pet.coins)} {SIL}</span>
            </div>

            <div className="catalog">
              <div className="section-label">Food</div>
              {ownedItems.length === 0 ? (
                <p className="empty">No food yet — buy some or open a chest 🎁</p>
              ) : (
                <div className="inv-grid">
                  {ownedItems.map(({ food, qty }) => (
                    <button
                      key={food.id}
                      className={"inv-item" + (food.rarity !== "common" ? " inv-item-rare" : "") + (justFedId === food.id ? " inv-item-fed" : "")}
                      onClick={() => feedFromInventory(food)}
                      title={foodTitle(food)}
                    >
                      <span className="inv-qty">×{qty}</span>
                      <span className="rar-dot" style={{ background: RARITY[food.rarity].color }} />
                      <span className="inv-emoji">{food.emoji}</span>
                      <span className="inv-name">{food.label}</span>
                      <span className="inv-feed">{justFedId === food.id ? "✓ Fed" : "Feed"}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="section-label">Accessories</div>
              {ownedAcc.length === 0 ? (
                <p className="empty">No accessories yet — win some from a chest 🎀</p>
              ) : (
                <div className="inv-grid">
                  {ownedAcc.map((a) => {
                    const worn = pet.accessories.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        className={"inv-item" + (worn ? " inv-item-rare" : "")}
                        onClick={() => toggleAccessory(a.id)}
                        title={`${RARITY[a.rarity].label} · ${accDesc(a.type, a.rarity)}`}
                      >
                        <span className="rar-dot" style={{ background: RARITY[a.rarity].color }} />
                        <span className="inv-emoji">{a.emoji}</span>
                        <span className="inv-name">{a.label}</span>
                        <span className="inv-feed">{worn ? "Worn ✓" : "Wear"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Leaderboard ===== */}
      {modal === "leaderboard" && pet && (() => {
        const cloud = isCloudEnabled();
        const loading = cloud && !lbLoaded;
        const realMode = cloud && lbLoaded && topScores !== null; // есть живой топ из Supabase
        // Строки для показа + ранг игрока (0 = вне топа / нет счёта).
        let rows: { key: string; name: string; score: number; you: boolean }[];
        let myRank: number;
        if (realMode) {
          rows = topScores!.map((r) => ({
            key: r.wallet,
            name: (r.name && r.name.trim()) || shortAddress(r.wallet),
            score: r.score,
            you: !!wallet && r.wallet === wallet,
          }));
          const idx = wallet ? topScores!.findIndex((r) => r.wallet === wallet) : -1;
          myRank = idx >= 0 ? idx + 1 : 0;
        } else {
          rows = [
            ...LEADERBOARD_BOTS.map((b) => ({ key: b.name, name: b.name, score: b.score, you: false })),
            { key: "you", name: pet.name, score: pet.bestScore, you: true },
          ].sort((a, b) => b.score - a.score);
          myRank = rows.findIndex((r) => r.you) + 1;
        }
        const inTop = myRank > 0;
        const reward = inTop ? runRewardForRank(myRank) : pet.bestScore > 0 ? 50 : 0;
        const left = pet.lastRunReward + RUN_REWARD_COOLDOWN - Date.now();
        const canReward = realMode ? rewardsUnlocked && pet.bestScore > 0 : pet.bestScore > 0;
        const rewardReady = canReward && left <= 0;
        const showMyRow = realMode && !!wallet && pet.bestScore > 0 && !inTop; // в игре, но не в топ-20
        async function claimRunReward() {
          if (!rewardReady) return;
          const res = await pvRunReward(myRank || 999); // сервер начисляет по рангу (кулдаун серверный)
          if ("error" in res) { if (typeof res.coins === "number") setCoins(res.coins); return setToast(res.error.includes("10+") ? "🏆 Run rewards unlock for everyone 2h after the game hits 10+ players" : "Reward not ready yet"); }
          setPet((p) => (p ? { ...p, coins: res.coins, lastRunReward: Date.now(), updatedAt: Date.now() } : p));
          setToast(`🏆 Run reward${inTop ? ` (rank #${myRank})` : ""}: +${res.credited} ${SIL}`);
        }
        const hh = Math.max(0, Math.floor(left / 3_600_000));
        const mm = Math.max(0, Math.floor((left % 3_600_000) / 60_000));
        return (
          <div className="scrim" onClick={() => setModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>🏆 {realMode ? "Global top runs" : "Top runs"}</h3>
              </div>
              <p className="subtitle" style={{ marginTop: -4 }}>
                {realMode ? "Best rhythm scores across all players. Top runs earn DC every hour." : "Best Play scores. Top runs earn DC every hour."}
              </p>
              {loading ? (
                <p className="empty">Loading the leaderboard… ⏳</p>
              ) : (
                <div className="lb-list">
                  {rows.length === 0 ? (
                    <p className="empty">No scores yet — be the first! 🎵</p>
                  ) : (
                    rows.map((r, i) => (
                      <div key={r.key} className={"lb-row" + (r.you ? " lb-you" : "")}>
                        <span className="lb-rank">{i + 1}</span>
                        <span className="lb-name">{r.name}{r.you ? " (you)" : ""}</span>
                        <span className="lb-sil">♪ {r.score.toLocaleString()}</span>
                      </div>
                    ))
                  )}
                  {showMyRow && (
                    <div className="lb-row lb-you">
                      <span className="lb-rank">—</span>
                      <span className="lb-name">{pet.name} (you)</span>
                      <span className="lb-sil">♪ {pet.bestScore.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
              {realMode && !wallet && (
                <p className="empty">🔌 Connect your wallet to join the global leaderboard and earn DC.</p>
              )}
              <button className="btn btn-daily" disabled={!rewardReady} onClick={claimRunReward}>
                {!canReward
                  ? realMode && !wallet
                    ? "🔌 Connect wallet to earn"
                    : "🏆 Play a run to earn rewards"
                  : rewardReady
                  ? `🏆 Claim ${inTop ? `rank #${myRank} ` : ""}reward +${reward} ${SIL}`
                  : `🏆 Next reward in ${hh}h ${mm}m`}
              </button>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* ===== Sil Roulette ===== */}
      {modal === "roulette" && pet && (
        <Roulette
          coins={pet.coins}
          onClose={() => setModal(null)}
          play={async (stake, bet) => {
            const r = await pvRoulette(stake, bet); // сервер решает исход и меняет баланс
            return r;
          }}
          onSettled={(coins) => setCoins(coins)}
        />
      )}

      {/* ===== Play: rhythm mini-game ===== */}
      {modal === "play" && pet && (
        <RhythmGame
          petName={pet.name}
          petSpecies={pet.species}
          petEmoji={PETS.find((p) => p.id === pet.species)?.emoji ?? "🦆"}
          onClose={() => setModal(null)}
          onFinish={(score, happy, durationMs) => {
            const cost = playFullnessCost(durationMs);
            const prevBest = petRef.current?.bestScore ?? 0;
            setPet((p) =>
              p
                ? {
                    ...p,
                    stats: { ...p.stats, happiness: clamp(p.stats.happiness + happy), fullness: clamp(p.stats.fullness - cost) },
                    totalScore: p.totalScore + score,
                    bestScore: Math.max(p.bestScore, score),
                    updatedAt: Date.now(),
                  }
                : p,
            );
            // Новый личный рекорд → отправляем в глобальный лидерборд (если кошелёк подключён).
            if (wallet && score > prevBest && petRef.current) submitScore(wallet, petRef.current.name, score);
            setToast(`🎵 Score ${score} · +${happy} happy · −${cost} fullness`);
          }}
        />
      )}

      {/* ===== Marketplace ===== */}
      {modal === "market" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>🛍️ Marketplace</h3>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>Buy and sell pets for real <b>ETH</b> — paid straight from your wallet.</p>
            <div className="market-tabs">
              <button className={"market-tab" + (marketTab === "exclusive" ? " market-tab-on" : "")} onClick={() => setMarketTab("exclusive")}>✨ Exclusive</button>
              <button className={"market-tab" + (marketTab === "player" ? " market-tab-on" : "")} onClick={() => setMarketTab("player")}>👥 Player</button>
              <button className={"market-tab" + (marketTab === "auction" ? " market-tab-on" : "")} onClick={() => setMarketTab("auction")}>🔨 Auction</button>
            </div>

            {marketTab === "exclusive" && (() => {
              const cloud = isCloudEnabled();
              const loading = cloud && !exLoaded;
              const rows = exclusives ?? [];
              return (
                <>
                  {isAdmin && (
                    <>
                      <div className="section-label">Add an exclusive (admin)</div>
                      <p className="subtitle" style={{ marginTop: -4 }}>Drop a limited pet the community can only buy here, for ETH.</p>
                      <div className="list-controls">
                        <select className="name-input list-select" value={exSpecies} onChange={(e) => setExSpecies(e.target.value)}>
                          <option value="">Choose a species…</option>
                          {PETS.map((p) => <option key={p.id} value={p.id}>{p.label} · {RARITY[p.rarity].label}</option>)}
                        </select>
                        <input className="name-input list-price" type="number" min="0" step="0.01" placeholder="Price in ETH" value={exPrice} onChange={(e) => setExPrice(e.target.value)} />
                        <input className="name-input list-price" type="number" min="1" step="1" placeholder="Qty" value={exStock} onChange={(e) => setExStock(e.target.value)} />
                        <button className="btn btn-primary" onClick={addExclusive}>✨ Add</button>
                      </div>
                    </>
                  )}

                  <div className="section-label">Exclusive pets</div>
                  <p className="subtitle" style={{ marginTop: -4 }}>Limited ducks sold for <b>ETH</b> by Duckverse — grab them before they're gone.</p>
                  {loading ? (
                    <p className="empty">Loading exclusives… ⏳</p>
                  ) : rows.length === 0 ? (
                    <p className="empty">No exclusives right now — check back soon. ✨</p>
                  ) : (
                    <div className="inv-grid">
                      {rows.map((ex) => {
                        const info = PETS.find((p) => p.id === ex.species)!;
                        const owned = !!pet && pet.ownedSpecies.includes(ex.species);
                        const soldOut = (ex.stock ?? 0) <= 0;
                        return (
                          <div key={ex.id} className="inv-item inv-item-tall market-listing">
                            {isAdmin && <button className="mini-x" onClick={() => removeExclusive(ex.id)} title="Remove exclusive">✕</button>}
                            <span className="rar-dot" style={{ background: RARITY[info.rarity].color }} />
                            <span className="inv-emoji"><PetArt species={ex.species} size={34} /></span>
                            <span className="inv-name">{ex.name || info.label}</span>
                            <span className="inv-perk">{soldOut ? "sold out" : `${ex.stock} left`}</span>
                            <span className="inv-feed">{ex.price} ETH</span>
                            {cloud && (
                              <button className="btn btn-primary market-buy" disabled={buying || soldOut || owned} onClick={() => buyExclusive(ex)}>
                                {owned ? "Owned" : soldOut ? "Sold out" : "Buy"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {cloud && !wallet && <p className="empty" style={{ marginTop: 8 }}>🔌 Connect your wallet to buy exclusives.</p>}
                </>
              );
            })()}

            {marketTab === "player" && (() => {
              const cloud = isCloudEnabled();
              const loading = cloud && !marketLoaded;
              type Row = { id: string; species: string; level: number; price: number; buffs: { kind: BuffKind; expiresAt: number }[]; accessories: string[]; seller: string; mine: boolean };
              // Общие лоты из Supabase (видны всем) или локальные (без облака — только свои).
              const listings: Row[] = cloud
                ? (marketListings ?? []).map((l) => ({ id: l.id, species: l.species, level: l.level, price: l.price, buffs: l.buffs ?? [], accessories: l.accessories ?? [], seller: l.seller, mine: !!wallet && l.seller === wallet }))
                : pet.listings.filter((l) => l.kind === "sale").map((l) => ({ id: l.id, species: l.species, level: l.level, price: l.price, buffs: l.buffs, accessories: l.accessories ?? [], seller: "you", mine: true }));
              // Питомцев для листинга можно выставить только НЕактивных (активного продавать нельзя).
              const listable = pet.ownedSpecies.filter((id) => id !== pet.species);
              const netPct = (10000 - MARKET_FEE_BPS) / 100;
              return (
                <>
                  <div className="section-label">Sell a duck</div>
                  <p className="subtitle" style={{ marginTop: -4 }}>
                    List a duck for a fixed ETH price. Listing escrows it — it leaves your collection until sold or cancelled. You receive {netPct}% (a {MARKET_FEE_BPS / 100}% fee goes to the treasury).
                  </p>
                  {cloud && !wallet ? (
                    <p className="empty">🔌 Connect your wallet to list a duck on the market.</p>
                  ) : listable.length === 0 ? (
                    <p className="empty">Switch to another pet first — you can't sell your active one.</p>
                  ) : (
                    <div className="list-controls">
                      <select className="name-input list-select" value={listSpecies} onChange={(e) => setListSpecies(e.target.value)}>
                        <option value="">Choose a duck…</option>
                        {listable.map((id) => {
                          const info = PETS.find((p) => p.id === id)!;
                          const lvl = pet.progress[id]?.level ?? 1;
                          return <option key={id} value={id}>{info.label} · Lv {lvl}</option>;
                        })}
                      </select>
                      <input
                        className="name-input list-price"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Price in ETH"
                        value={listPrice}
                        onChange={(e) => setListPrice(e.target.value)}
                      />
                      <button className="btn btn-primary" disabled={listBusy} onClick={listPet}>🏷️ List</button>
                    </div>
                  )}

                  <div className="section-label">Pets for sale</div>
                  {loading ? (
                    <p className="empty">Loading the market… ⏳</p>
                  ) : listings.length === 0 ? (
                    <p className="empty">No listings yet — be the first to list a duck!</p>
                  ) : (
                    <div className="inv-grid">
                      {listings.map((l) => {
                        const info = PETS.find((p) => p.id === l.species)!;
                        const activeBuffs = l.buffs.filter((b) => b.expiresAt > Date.now()).length;
                        const owned = !l.mine && !!pet && pet.ownedSpecies.includes(l.species);
                        // Наведение показывает: редкость, DC/min (зависит только от уровня — сервер капит пассив)
                        // и надетые на пета аксессуары (уходят покупателю вместе с петом).
                        const pvMin = +(BASE_SIL_PER_MIN * Math.min(levelSilMult(l.level), 3)).toFixed(2);
                        const accList = l.accessories.map((id) => accById(id)).filter((a): a is NonNullable<typeof a> => !!a);
                        const tip = `${RARITY[info.rarity].label} · ~${pvMin} ${SIL}/min · ${accList.length ? accList.map((a) => `${a.emoji} ${a.label}`).join(", ") : "No accessories"}`;
                        return (
                          <div key={l.id} className="inv-item inv-item-tall market-listing" title={tip}>
                            {l.mine && <button className="mini-x" onClick={() => cancelListing(l.id)} title="Cancel listing">✕</button>}
                            <span className="rar-dot" style={{ background: RARITY[info.rarity].color }} />
                            <span className="inv-emoji"><PetArt species={l.species} size={34} /></span>
                            <span className="inv-name">{info.label}</span>
                            <span className="inv-perk">Lv {l.level}{activeBuffs ? ` · ✨${activeBuffs}` : ""}{accList.length ? ` · ${accList.map((a) => a.emoji).join("")}` : ""}</span>
                            <span className="inv-feed">{l.price} ETH</span>
                            {l.mine ? (
                              <span className="market-seller">your listing</span>
                            ) : cloud ? (
                              <button className="btn btn-primary market-buy" disabled={buying || owned} onClick={() => buyPet(l)}>{owned ? "Owned" : "Buy"}</button>
                            ) : (
                              <span className="market-seller">you</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}

            {marketTab === "auction" && (
              <div className="market-empty">
                <div className="market-empty-emoji">🔨</div>
                <p className="empty">Live ETH auctions are coming soon — bid on rare pets and win them. Stay tuned!</p>
              </div>
            )}

            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Pet interaction menu ===== */}
      {petMenu && pet && (
        <div className="scrim" onClick={() => setPetMenu(false)}>
          <div className="pet-menu" onClick={(e) => e.stopPropagation()}>
            <div className="pet-menu-title" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <PetArt species={pet.species} size={28} /> {pet.name}
            </div>
            {dead ? (
              <>
                <button className="pet-menu-btn" onClick={() => { setPetMenu(false); setModal("shop"); }}>💊 Revive in Shop</button>
                <button className="pet-menu-btn" onClick={() => { setPetMenu(false); setModal("pets"); }}>🔄 Switch duck</button>
              </>
            ) : (
              <>
                <button className="pet-menu-btn" onClick={pat}>🤚 Pet</button>
                <button className="pet-menu-btn" onClick={() => { setPetMenu(false); setModal("potions"); }}>🧪 Potions</button>
                <button className="pet-menu-btn" onClick={() => { setPetMenu(false); setModal("pets"); }}>🔄 Switch duck</button>
              </>
            )}
            <button className="btn btn-ghost" onClick={() => setPetMenu(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Game 2: Battle Arena ===== */}
      {modal === "battle" && pet && (
        <BattleGame
          onClose={() => setModal(null)}
          onWin={battleWin}
          onWinNoLoot={battleWinNoLoot}
          onLose={battleLose}
          petName={pet.name}
          petSpecies={pet.species}
          level={pet.level}
          accessories={pet.accessories}
          loadout={loadoutPower(pet.level, pet.accessories, activePowerBuff(pet.powerBuff, Date.now()) + potEff.power, speciesRarity(pet.species))}
          powerBuffActive={activePowerBuff(pet.powerBuff, Date.now()) + potEff.power}
          wins={pet.battleWins}
          losses={pet.battleLosses}
          coins={pet.coins}
          health={pet.stats.health}
          arenaTop={arenaTop}
          myWallet={wallet}
          onlineEnabled={!!wallet && isCloudEnabled()}
          fetchOpponent={() => (wallet ? findPvpOpponent(wallet) : Promise.resolve(null))}
          queuePoll={battleQueuePoll}
          queueLeave={battleQueueLeave}
          queueFinish={battleQueueFinish}
        />
      )}

      {/* ===== Play: game picker ===== */}
      {modal === "playmenu" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>🎾 Play</h3></div>
            <p className="subtitle" style={{ marginTop: -4 }}>Choose a game.</p>
            <button className="btn btn-primary" onClick={() => setModal("play")}>🎵 Rhythm</button>
            <button className="btn btn-battle" onClick={() => setModal("battle")}>⚔️ Battle Arena</button>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Токен $DC (DuckCoin) ===== */}
      {modal === "pumpfun" && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>🚀 DuckCoin</h3></div>
            <p className="subtitle" style={{ marginTop: -4 }}><b>DuckCoin ($DC)</b> is the in-game currency. It is planned to launch on Robinhood Chain paired with the <b>NVDA</b> RWA token. Not live yet.</p>
            <a className="btn btn-primary" href={LINK_LAUNCHPAD} target="_blank" rel="noreferrer">Open the launchpad ↗</a>
            <div className="token-line">
              <span className="tk-tick">$DC · {TOKEN_CA ? "live" : "not launched"}</span>
              {TOKEN_CA ? (
                <>
                  <span
                    className={"tk-ca" + (caCopied ? " tk-ca-copied" : "")}
                    title={TOKEN_CA}
                    onClick={() => {
                      navigator.clipboard?.writeText(TOKEN_CA);
                      setToast("CA copied");
                      setCaCopied(true);
                      setTimeout(() => setCaCopied(false), 1000);
                    }}
                  >
                    {caCopied ? "✓ copied" : `${TOKEN_CA.slice(0, 6)}…${TOKEN_CA.slice(-4)}`}
                  </span>
                  <a className="tk-buy" href={LINK_LAUNCHPAD} target="_blank" rel="noreferrer">buy on Pons Family ▸</a>
                  <span className="tk-warn">only trust this address</span>
                </>
              ) : (
                <span className="tk-ca">coming soon</span>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Exchange Sil ↔ ETH ===== */}
      {modal === "buysil" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>💰 Buy DC</h3>
              <span className="coins"><Coin /> {Math.floor(pet.coins).toLocaleString()} {SIL}</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>Buy DC with real ETH — 1 {COIN} = {ETH_PV_RATE.toLocaleString()} DC.</p>

            {!wallet ? (
              <p className="empty">🔌 Connect your wallet to buy DC with ETH.</p>
            ) : (
              <div className="sil-packs">
                {ETH_BUY_PACKS.map((s) => (
                  <button key={s} className="sil-pack" disabled={buying} onClick={() => buyPvReal(s)}>
                    <span className="sil-pack-amt"><Coin /> {(s * ETH_PV_RATE).toLocaleString()}</span>
                    <span className="sil-pack-price">{s} ETH</span>
                  </button>
                ))}
              </div>
            )}

            {wallet && (
              <>
                <div className="section-label">Sell DC — {ETH_SELL_RATE.toLocaleString()} DC → 1 {COIN}</div>
                <div className="sil-packs">
                  {ETH_SELL_PACKS.map((s) => (
                    <button key={s} className="sil-pack" disabled={buying || Math.floor(pet.coins) < s} onClick={() => sellPvReq(s)}>
                      <span className="sil-pack-amt">{+(s / ETH_SELL_RATE).toFixed(4)} ETH</span>
                      <span className="sil-pack-price"><Coin /> {s.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
                <p className="empty">📨 Selling creates a request — ETH is paid out after manual approval.</p>
              </>
            )}

            {buying && <p className="subtitle" style={{ textAlign: "center" }}>⏳ Processing…</p>}
            <p className="empty">⚠️ This is <b>real ETH on Robinhood Chain</b> — double-check the amount before confirming in your wallet.</p>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Выбор кошелька (EIP-6963) ===== */}
      {modal === "wallets" && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>👛 Connect a wallet</h3></div>
            <p className="subtitle" style={{ marginTop: -4 }}>
              Duckverse runs on <b>{CHAIN.name}</b>. Pick your wallet — it will ask to switch networks.
            </p>
            <div className="wallet-list">
              {KNOWN_WALLETS.map((known) => {
                const found = foundWallets.find((f) => f.rdns === known.rdns);
                return (
                  <button
                    key={known.rdns}
                    className={"wallet-opt" + (found ? "" : " wallet-opt-missing")}
                    onClick={() => (found ? connectWallet(found.rdns) : window.open(known.install, "_blank", "noopener"))}
                  >
                    <WalletIcon icon={found?.icon} name={known.name} color={known.color} />
                    <span className="wallet-opt-name">{known.name}</span>
                    <span className="wallet-opt-tag">{found ? "Connect" : "Install ↗"}</span>
                  </button>
                );
              })}
              {/* Любой другой кошелёк, который объявился, но в наш список не входит. */}
              {foundWallets.filter((f) => !KNOWN_WALLETS.some((k) => k.rdns === f.rdns)).map((f) => (
                <button key={f.rdns} className="wallet-opt" onClick={() => connectWallet(f.rdns)}>
                  <WalletIcon icon={f.icon} name={f.name} color="#8a8f98" />
                  <span className="wallet-opt-name">{f.name}</span>
                  <span className="wallet-opt-tag">Connect</span>
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Admin: sell requests ===== */}
      {modal === "admin" && isAdmin && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>🛠️ Payout requests</h3></div>
            <p className="subtitle" style={{ marginTop: -4 }}>Approve to pay ETH from the treasury. Only DC sells can be rejected (refunds DC); pet sales &amp; refunds are final.</p>
            {adminReqs === null ? (
              <p className="empty">Loading…</p>
            ) : adminReqs.length === 0 ? (
              <p className="empty">No pending requests 🎉</p>
            ) : (
              <div className="lb-list">
                {adminReqs.map((r) => {
                  // sell = продажа DC (можно reject→возврат DC); market = продажа пета; refund = возврат неуд. покупки.
                  const label = r.kind === "market" ? `🏷️ Duck sale → ${r.sol} ETH` : r.kind === "refund" ? `↩️ Refund → ${r.sol} ETH` : null;
                  return (
                    <div key={r.id} className="admin-req">
                      <div className="admin-req-info">
                        <span className="admin-req-amt">{label ?? <><Coin /> {r.pv.toLocaleString()} → {r.sol} ETH</>}</span>
                        <button className="admin-req-who quest-wallet" title="Copy wallet" onClick={() => { navigator.clipboard?.writeText(r.wallet); setToast("Address copied"); }}>📋 {shortAddress(r.wallet)}</button>
                      </div>
                      <div className="admin-req-btns">
                        <button className="btn btn-primary admin-ok" disabled={payoutBusy} onClick={() => doPayout(r.id, "approve")}>Approve</button>
                        {r.kind === "sell" && <button className="btn btn-ghost admin-no" disabled={payoutBusy} onClick={() => doPayout(r.id, "reject")}>Reject</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {adminStuck && adminStuck.length > 0 && (
              <>
                <div className="section-label" style={{ marginTop: 14 }}>⚠️ Stuck payouts</div>
                <p className="subtitle" style={{ marginTop: -4 }}>A payout failed mid-send. Check the treasury tx history first — if no ETH left, Reset to retry.</p>
                <div className="lb-list">
                  {adminStuck.map((r) => (
                    <div key={r.id} className="admin-req">
                      <div className="admin-req-info">
                        <span className="admin-req-amt">{r.sol} ETH · <b>{r.status}</b></span>
                        <button className="admin-req-who quest-wallet" title="Copy wallet" onClick={() => { navigator.clipboard?.writeText(r.wallet); setToast("Address copied"); }}>📋 {shortAddress(r.wallet)}</button>
                      </div>
                      <div className="admin-req-btns">
                        <button className="btn btn-ghost" disabled={payoutBusy} onClick={() => doPayout(r.id, "reset")}>Reset</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="section-label" style={{ marginTop: 14 }}>🎯 Quest rewards</div>
            <p className="subtitle" style={{ marginTop: -4 }}>Copy the wallet, send the ETH from the treasury yourself, then Mark paid.</p>
            {adminQuests === null ? (
              <p className="empty">Loading…</p>
            ) : adminQuests.length === 0 ? (
              <p className="empty">No pending quest rewards 🎉</p>
            ) : (
              <div className="lb-list">
                {adminQuests.map((c) => {
                  const q = QUESTS.find((x) => x.id === c.quest_id);
                  return (
                    <div key={c.id} className="admin-req">
                      <div className="admin-req-info">
                        <span className="admin-req-amt">{q ? `${q.emoji} ${q.label}` : c.quest_id} → {q?.reward ?? "?"} ETH</span>
                        <button className="admin-req-who quest-wallet" title="Copy wallet" onClick={() => { navigator.clipboard?.writeText(c.wallet); setToast("Address copied"); }}>📋 {shortAddress(c.wallet)}</button>
                      </div>
                      <div className="admin-req-btns">
                        <button className="btn btn-primary admin-ok" disabled={payoutBusy} onClick={() => doQuestPaid(c.id)}>Mark paid</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Breed ===== */}
      {modal === "breed" && pet && (
        <div className="scrim" onClick={closeBreed}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>🧬 Breed</h3>
              <span className="coins"><Coin /> {Math.floor(pet.coins)} {SIL}</span>
            </div>

            {bred ? (
              <div style={{ textAlign: "center" }}>
                <p className="subtitle">A new friend was born! 🐣</p>
                <div style={{ margin: "10px 0" }}><PetArt species={bred.id} size={96} /></div>
                <p className="rg-result" style={{ color: RARITY[bred.rarity].color }}>
                  {PETS.find((p) => p.id === bred.id)?.label} · {RARITY[bred.rarity].label}
                </p>
                <button className="btn btn-primary" onClick={() => { setBred(null); setBreedSel([]); }}>Collect</button>
              </div>
            ) : breedEligible.length < 2 ? (
              <p className="empty">
                Breeding unlocks when you have two pets at level {BREED_LEVEL}. You have {breedEligible.length}. Level pets up by feeding them 🍖
              </p>
            ) : (
              <>
                <p className="subtitle" style={{ marginTop: -4 }}>Pick two level-{BREED_LEVEL}+ pets — breed a new one (rare → mythic).</p>
                <div className="inv-grid">
                  {breedEligible.map((id) => {
                    const info = PETS.find((p) => p.id === id)!;
                    const sel = breedSel.includes(id);
                    return (
                      <button
                        key={id}
                        className={"inv-item" + (sel ? " inv-item-rare" : "")}
                        onClick={() => setBreedSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur))}
                        title={info.label}
                      >
                        <span className="rar-dot" style={{ background: RARITY[info.rarity].color }} />
                        <span className="inv-emoji"><PetArt species={id} size={34} /></span>
                        <span className="inv-name">{info.label}</span>
                        <span className="inv-feed">Lv {petLevel(id)}{sel ? " ✓" : ""}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="actions">
                  <button className="btn btn-ghost" onClick={closeBreed}>Close</button>
                  <button className="btn btn-primary" disabled={breedSel.length !== 2 || pet.coins < BREED_COST} onClick={breed}>
                    Breed · <Coin /> {BREED_COST}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Name a new pet (before selecting it) ===== */}
      {namePet && pet && (() => {
        const info = PETS.find((p) => p.id === namePet);
        return (
          <div className="scrim scrim-top" onClick={() => setNamePet(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><h3>Name your new {info?.label}</h3></div>
              <div style={{ textAlign: "center", margin: "8px 0" }}><PetArt species={namePet} size={80} /></div>
              <div className="name-row">
                <input
                  className="name-input"
                  placeholder={`Name your ${info?.label.toLowerCase()}`}
                  value={petNameInput}
                  maxLength={20}
                  autoFocus
                  onChange={(e) => setPetNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmPetName()}
                />
                <button className="btn btn-primary" disabled={!petNameInput.trim()} onClick={confirmPetName}>Name & select</button>
              </div>
              <button className="btn btn-ghost" onClick={() => setNamePet(null)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* ===== Pets ===== */}
      {modal === "pets" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Your pets</h3>
              <span className="coins">{collectiblePets.filter((p) => pet.ownedSpecies.includes(p.id)).length}/{collectiblePets.length}</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>Tap to switch. Each duck has a unique perk — locked ones drop from the Duck Chest 🥚</p>
            <div className="inv-grid">
              {[...basePets, ...collectiblePets].map((p) => {
                // Доступен только тот, которым владеешь: стартовый базовый выбран при создании,
                // остальные базовые заблокированы; rare+ — открываются из сундука.
                const owned = pet.ownedSpecies.includes(p.id);
                const active = pet.species === p.id;
                const hasPerk = !!SPECIES_PERK[p.id];
                const perk = SPECIES_PERK[p.id]?.label ?? (p.rarity === "common" ? "Starter duck" : "");
                const isNew = NEW_SPECIES.has(p.id);
                return (
                  <button
                    key={p.id}
                    className={"inv-item inv-item-tall" + (active ? " inv-item-rare" : "") + (owned ? "" : " inv-locked")}
                    onClick={() => (owned ? switchSpecies(p.id) : setToast(p.rarity === "common" ? "You already chose your starter duck 🔒" : "Win it from the Duck Chest 🥚"))}
                    title={`${RARITY[p.rarity].label} · ${perk}`}
                  >
                    {isNew && <span className="inv-new">New</span>}
                    <span className="rar-dot" style={{ background: RARITY[p.rarity].color }} />
                    <span className="inv-emoji"><PetArt species={p.id} size={34} /></span>
                    <span className="inv-name">{p.label}</span>
                    <span className={"inv-perk" + (hasPerk ? " inv-perk-badge" : "")}>{perk}</span>
                    <span className="inv-feed">{!owned ? "🔒 Locked" : active ? "Active ✓" : "Select"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== Accessories ===== */}
      {modal === "accessories" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Accessories</h3>
              <span className="coins">{pet.ownedAccessories.length}/{ACCESSORIES.length}</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>All accessories — locked ones drop from the Accessory Chest 🎀</p>

            <div className="catalog">
              {SLOTS.map((s) => (
                <div key={s.type}>
                  <div className="section-label">{s.label}</div>
                  <div className="inv-grid">
                    {ACCESSORIES.filter((a) => a.type === s.type).map((a) => {
                      const owned = pet.ownedAccessories.includes(a.id);
                      const worn = pet.accessories.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          className={"inv-item" + (worn ? " inv-item-rare" : "") + (owned ? "" : " inv-locked")}
                          onClick={() => (owned ? toggleAccessory(a.id) : setToast("Win it from a chest 🎀"))}
                          title={`${RARITY[a.rarity].label} · ${accDesc(a.type, a.rarity)}`}
                        >
                          <span className="rar-dot" style={{ background: RARITY[a.rarity].color }} />
                          <span className="inv-emoji">{a.emoji}</span>
                          <span className="inv-name">{a.label}</span>
                          <span className="inv-feed">{!owned ? "🔒 Locked" : worn ? "Worn ✓" : "Wear"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Accessory slot picker (only owned of the clicked type) ===== */}
      {accPicker && pet && (() => {
        const slot = SLOTS.find((s) => s.type === accPicker);
        const owned = ACCESSORIES.filter((a) => a.type === accPicker && pet.ownedAccessories.includes(a.id));
        const equipped = ACCESSORIES.find((a) => a.type === accPicker && pet.accessories.includes(a.id));
        return (
          <div className="scrim" onClick={() => setAccPicker(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>{slot?.ghost} {slot?.label}</h3>
              </div>
              {owned.length === 0 ? (
                <p className="empty">No {slot?.label.toLowerCase()} yet — win one from the Accessory Chest 🎀</p>
              ) : (
                <div className="inv-grid">
                  {owned.map((a) => {
                    const worn = pet.accessories.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        className={"inv-item" + (worn ? " inv-item-rare" : "")}
                        onClick={() => toggleAccessory(a.id)}
                        title={`${RARITY[a.rarity].label} · ${accDesc(a.type, a.rarity)}`}
                      >
                        <span className="rar-dot" style={{ background: RARITY[a.rarity].color }} />
                        <span className="inv-emoji">{a.emoji}</span>
                        <span className="inv-name">{a.label}</span>
                        <span className="inv-feed">{worn ? "Worn ✓" : "Wear"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {equipped && (
                <button className="btn btn-ghost" onClick={() => toggleAccessory(equipped.id)}>Take off {equipped.label}</button>
              )}
              <button className="btn btn-ghost" onClick={() => setAccPicker(null)}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* ===== Chest preview ===== */}
      {preview && previewData && pet && (
        <div className="scrim scrim-top" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{preview.chest.emoji} {preview.chest.label} chest</h3>
              <span className="coins"><Coin /> {price(preview.chest.cost)}</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>Possible drops — hover an item to see its chance.</p>
            <div className="inv-grid">
              {previewData.pool.map((i) => (
                <div className="inv-item preview-item" key={i.id} title={chestItemTitle(i)}>
                  <span className="rar-dot" style={{ background: RARITY[i.rarity].color }} />
                  <span className="inv-emoji">{preview.kind === "pet" ? <PetArt species={i.id} size={30} /> : i.emoji}</span>
                  <span className="inv-name">{i.label}</span>
                  <span className="pchance" style={{ color: RARITY[i.rarity].color }}>{fmtChance(previewData.chanceOf(i))}</span>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>Exit</button>
              <button className="btn btn-primary" disabled={pet.coins < price(preview.chest.cost)} onClick={spinPreview}>
                Spin · <Coin /> {price(preview.chest.cost)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Chest opening (roulette) ===== */}
      {chest && (
        <div className="scrim scrim-top" onClick={() => chest.revealed && setChest(null)}>
          <div className="chest-open" onClick={(e) => e.stopPropagation()}>
            <div className="reel-viewport">
              <div className="reel-pointer" />
              <div className="reel-track" style={{ transform: `translateX(${reelOffset}px)` }}>
                {chest.strip.map((em, i) => (
                  <div
                    className={"reel-item" + (chest.revealed && i === chest.winIdx ? " reel-item-won" : "")}
                    key={i}
                    style={{ background: `${chest.colors[i]}26`, borderBottom: `3px solid ${chest.colors[i]}` }}
                  >
                    <ReelIcon v={em} />
                  </div>
                ))}
              </div>
            </div>
            {chest.revealed ? (
              <>
                <p className="won-text">
                  You got <b>{chest.won.label}</b>{" "}
                  <span style={{ display: "inline-block", verticalAlign: "middle" }}><ReelIcon v={chest.won.emoji} size={28} /></span>
                  {chest.won.rarityLabel && (
                    <span className="rare-badge" style={{ background: chest.won.rarityColor, color: "#1a1205" }}>
                      {chest.won.rarityLabel}
                    </span>
                  )}
                </p>
                <button className="btn btn-primary" onClick={() => setChest(null)}>Collect</button>
              </>
            ) : (
              <p className="subtitle">Opening…</p>
            )}
          </div>
        </div>
      )}

      {/* ===== Toast ===== */}
      {toast && <div className={"toast" + (toastLeaving ? " toast-out" : "")}>{toast}</div>}
    </div>
  );
}
