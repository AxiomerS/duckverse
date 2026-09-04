import { type PetId, isBasePet } from "./pets";
import { type BuffKind } from "./buffs";
import { type Stats, clamp, decay, decayMult, decayInactive, statCap, START_COINS, GRANT_V } from "./mechanics";
import { mythicAcc, STARTER_ACCESSORIES } from "./accessories";
import { type ActivePotion } from "./potions";

export const STORAGE_KEY = "duckverse.pet";

// Лот на рынке игроков: продажа или аукцион своего питомца (с уровнем и баффами).
// Цену/стартовую ставку задаёт продавец. Реальная торговля между игроками — с бэкендом.
export type MarketListing = {
  id: string;
  kind: "sale" | "auction";
  species: string;
  level: number;
  buffs: { kind: BuffKind; expiresAt: number }[];
  accessories?: string[]; // аксессуары, надетые на выставленного пета (уходят покупателю при продаже)
  price: number; // SOL: фикс-цена (sale) или стартовая ставка (auction)
  createdAt: number;
};

export type SavedPet = {
  species: PetId;
  name: string; // имя активного питомца (= names[species])
  names: Record<string, string>; // имя каждого питомца игрока (speciesId → имя)
  stats: Stats;
  coins: number; // баланс Silana
  sol: number; // локальный баланс SOL (для обмена Sil↔SOL; настоящий кошелёк — позже)
  inventory: Record<string, number>; // foodId -> количество
  ownedSpecies: string[]; // виды, которыми владеет игрок (между ними можно переключаться)
  ownedAccessories: string[]; // id аксессуаров, которыми владеет питомец
  accessories: string[]; // надетые id аксессуаров (по одному на тип)
  xp: number; // прогресс активного питомца к следующему уровню
  level: number; // уровень активного питомца
  buffs: { kind: BuffKind; expiresAt: number }[]; // временные баффы активного питомца
  powerBuff: { amount: number; expiresAt: number } | null; // временная прибавка силы от еды (Игра №2)
  potionInv: Record<string, number>; // купленные зелья (potionId → количество)
  potions: ActivePotion[]; // активные (выпитые) зелья с временем истечения
  questClaimed: string[]; // id скрытых (закрытых крестиком) квестов
  questDone: string[]; // id забранных квестов (награда запрошена) — показываются перечёркнутыми
  listings: MarketListing[]; // выставленные игроком лоты (продажа/аукцион)
  // Сохранённый прогресс НЕактивных питомцев (активный живёт в полях выше). accessories — надетые на
  // каждого неактивного пета аксессуары (остаются на нём при переключении, уходят при продаже).
  progress: Record<string, { stats: Stats; xp: number; level: number; buffs: { kind: BuffKind; expiresAt: number }[]; accessories?: string[] }>;
  lastDaily: number;
  dailyStreak: number; // подряд забранных daily-наград без пропуска окна — чисто визуальный счётчик
  totalScore: number; // суммарные очки за все игры Play (накопительно, для показа в углу)
  bestScore: number; // лучший счёт за один заход (для лидерборда)
  lastRunReward: number; // когда в последний раз забирали почасовую награду за топ-забег
  battleWins: number; // победы в Игре №2
  battleLosses: number; // поражения в Игре №2
  grantV: number; // применённая версия разовой выдачи монет
  updatedAt: number;
};

export function loadPet(): SavedPet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SavedPet> & { species: PetId; name: string; stats: Stats; updatedAt: number };
    // Разовое пополнение: существующие питомцы один раз поднимаются до START_COINS (GRANT_V).
    let coins = p.coins ?? START_COINS;
    if ((p.grantV ?? 0) < GRANT_V) coins = Math.max(coins, START_COINS);
    const now = Date.now();
    const buffs = (p.buffs ?? []).filter((b) => b.expiresAt > now);
    const accessories = p.accessories ?? [];
    // Мёртвый питомец (health = 0) заморожен — не распадается и не лечится сам.
    const hours = (now - p.updatedAt) / 3_600_000;
    const mr = mythicAcc(accessories);
    let stats: Stats;
    // Мёртвый питомец заморожен (health = 0) — оживить лекарством. Теперь это касается ВСЕХ, включая
    // базовых: базовый пет умирает, если его не кормить (starveOnly), и тоже замерзает при смерти.
    if (p.stats.health <= 0) {
      stats = p.stats;
    } else {
      // Распад за закрытый период, затем mythic-регенерация (но без оффлайн-Sil/XP).
      const cap = statCap(p.level ?? 1);
      stats = decay(p.stats, p.updatedAt, now, decayMult(buffs, accessories, p.species, now), cap, 1, isBasePet(p.species));
      stats = { ...stats, fullness: clamp(stats.fullness + mr.fRegen * hours, cap), happiness: clamp(stats.happiness + mr.hRegen * hours, cap) };
    }
    return {
      species: p.species,
      name: p.name,
      names: p.names ?? { [p.species]: p.name }, // старые сейвы: имя активного питомца
      stats,
      coins,
      sol: p.sol ?? 0,
      inventory: p.inventory ?? {},
      ownedSpecies: p.ownedSpecies ?? [p.species],
      ownedAccessories: p.ownedAccessories ?? [...STARTER_ACCESSORIES],
      accessories,
      xp: p.xp ?? 0,
      level: p.level ?? 1,
      buffs,
      powerBuff: p.powerBuff ?? null,
      potionInv: p.potionInv ?? {},
      potions: (p.potions ?? []).filter((x) => x.expiresAt > now),
      questClaimed: p.questClaimed ?? [],
      questDone: p.questDone ?? [],
      listings: p.listings ?? [],
      progress: decayInactive(p.progress ?? {}, p.updatedAt, now), // неактивные питомцы распадаются в 10× медленнее
      lastDaily: p.lastDaily ?? 0,
      dailyStreak: p.dailyStreak ?? 0,
      totalScore: p.totalScore ?? 0,
      bestScore: p.bestScore ?? 0,
      lastRunReward: p.lastRunReward ?? 0,
      battleWins: p.battleWins ?? 0,
      battleLosses: p.battleLosses ?? 0,
      grantV: GRANT_V,
      updatedAt: now,
    };
  } catch {
    return null;
  }
}

// Дозаполнить сейв дефолтами (для сейвов из ОБЛАКА — старые записи могут не иметь новых полей,
// иначе доступ к отсутствующему полю, напр. questDone.includes(), крашит рендер). Без decay-логики.
export function hydrateSave(p: any): SavedPet {
  return {
    species: p.species,
    name: p.name,
    names: p.names ?? { [p.species]: p.name },
    stats: p.stats,
    coins: p.coins ?? START_COINS,
    sol: p.sol ?? 0,
    inventory: p.inventory ?? {},
    ownedSpecies: p.ownedSpecies ?? [p.species],
    ownedAccessories: p.ownedAccessories ?? [...STARTER_ACCESSORIES],
    accessories: p.accessories ?? [],
    xp: p.xp ?? 0,
    level: p.level ?? 1,
    buffs: p.buffs ?? [],
    powerBuff: p.powerBuff ?? null,
    potionInv: p.potionInv ?? {},
    potions: p.potions ?? [],
    questClaimed: p.questClaimed ?? [],
    questDone: p.questDone ?? [],
    listings: p.listings ?? [],
    progress: p.progress ?? {},
    lastDaily: p.lastDaily ?? 0,
    dailyStreak: p.dailyStreak ?? 0,
    totalScore: p.totalScore ?? 0,
    bestScore: p.bestScore ?? 0,
    lastRunReward: p.lastRunReward ?? 0,
    battleWins: p.battleWins ?? 0,
    battleLosses: p.battleLosses ?? 0,
    grantV: p.grantV ?? GRANT_V,
    updatedAt: p.updatedAt ?? Date.now(),
  };
}
