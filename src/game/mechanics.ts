import { type BuffKind, activeMult } from "./buffs";
import { equippedBonuses, mythicAcc, accById } from "./accessories";
import { speciesEffect, isBasePet } from "./pets";

export type Stats = { fullness: number; happiness: number; health: number };

export const clamp = (n: number, max = 100) => Math.max(0, Math.min(max, n));

// XP, нужный, чтобы перейти С данного уровня на следующий. Растёт с каждым уровнем.
export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 50; // L1→2: 100, L2→3: 150, L3→4: 200, …
}

// Максимальная вместимость fullness и happiness растёт с уровнем (+10 за уровень).
export function statCap(level: number): number {
  return 100 + (level - 1) * 10;
}

// Скорости распада статов (в час).
export const FULLNESS_DECAY = 12;
export const HAPPINESS_DECAY = 8;
export const HEALTH_DECAY = 10;
export const HEALTH_RECOVER = 5;

// rate — общий множитель скорости (1 = обычный питомец; 0.1 = неактивный пет, распад в 10 раз медленнее).
// starveOnly — здоровье падает ТОЛЬКО от голода (fullness ≤ 0), а не от несчастья. Для БАЗОВЫХ питомцев:
// они умирают только если их не кормить, и никак иначе (грусть их не убивает).
export function decay(stats: Stats, from: number, to: number, mult: { f: number; h: number } = { f: 1, h: 1 }, cap = 100, rate = 1, starveOnly = false): Stats {
  const hours = Math.max(0, (to - from) / 3_600_000) * rate;
  if (hours === 0) return stats;
  const fullness = clamp(stats.fullness - FULLNESS_DECAY * hours * mult.f, cap);
  const happiness = clamp(stats.happiness - HAPPINESS_DECAY * hours * mult.h, cap);
  let health = stats.health;
  if (fullness <= 0 || (!starveOnly && happiness <= 0)) health -= HEALTH_DECAY * hours;
  else if (fullness >= 50 && happiness >= 50) health += HEALTH_RECOVER * hours;
  return { fullness, happiness, health: clamp(health) };
}

// Неактивные питомцы игрока тоже теряют статы — но в 10 раз медленнее (INACTIVE_DECAY_RATE). Пока пет
// неактивен, он НЕ умирает (health не опускается ниже 1): смерть возможна только у активного пета,
// которого не кормят. У неактивных нет надетых аксессуаров — распад считаем по их виду/баффам/уровню.
// accessories — аксессуары, надетые ИМЕННО на этого (неактивного) пета. Остаются на нём при переключении
// и уходят вместе с ним при продаже. Опционально (старые сейвы без поля читаем как []).
export type PetProgress = { stats: Stats; xp: number; level: number; buffs: { kind: BuffKind; expiresAt: number }[]; accessories?: string[] };
export const INACTIVE_DECAY_RATE = 0.1;
export function decayInactive(progress: Record<string, PetProgress>, from: number, to: number): Record<string, PetProgress> {
  const out: Record<string, PetProgress> = {};
  for (const sp of Object.keys(progress)) {
    const pr = progress[sp];
    // Уже мёртвый неактивный пет заморожен (оживить — только платно). Иначе бы floor(1) «воскрешал» его.
    if (pr.stats.health <= 0) { out[sp] = pr; continue; }
    const cap = statCap(pr.level);
    const dm = decayMult(pr.buffs ?? [], [], sp, to);
    const st = decay(pr.stats, from, to, dm, cap, INACTIVE_DECAY_RATE, isBasePet(sp));
    // Живой неактивный пет не умирает, пока неактивен (health не ниже 1) — смерть только у активного.
    out[sp] = { ...pr, stats: { ...st, health: Math.max(1, st.health) } };
  }
  return out;
}

// Итоговые множители распада: баффы × перки аксессуаров (усилены видовым "acc") × видовой распад.
export function decayMult(buffs: { kind: BuffKind; expiresAt: number }[], accessories: string[], speciesId: string, now: number): { f: number; h: number } {
  const b = activeMult(buffs, now);
  const e = equippedBonuses(accessories);
  const sp = speciesEffect(speciesId);
  const accBoost = 1 + sp.acc;
  return {
    f: Math.max(0, b.f * (1 - e.fDecay * accBoost) * (1 - sp.decayF)),
    h: Math.max(0, b.h * (1 - e.hDecay * accBoost) * (1 - sp.decayH)),
  };
}

// Пассивный доход Sil в минуту, пока приложение открыто. База 2/мин; каждый ТИП аксессуара
// с надетой легендаркой множит ставку ×1.5. По одной легендарке во всех четырёх типах → ×6 → 12/мин
// (несколько легендарок одного типа не стакаются — по одной на тип).
export const BASE_SIL_PER_MIN = 2;

export function silRate(accessories: string[], speciesId: string): number {
  const legTypes = new Set<string>();
  for (const id of accessories) {
    const a = accById(id);
    if (a && a.rarity === "legendary") legTypes.add(a.type);
  }
  const base = BASE_SIL_PER_MIN * (legTypes.size === 0 ? 1 : 1.5 * legTypes.size);
  return (base + mythicAcc(accessories).silFlat) * (1 + speciesEffect(speciesId).sil);
}

// Множитель дохода DC/min от уровня питомца: L1 = ×1.0, L2 = ×1.1, L3 = ×1.2, … (+10% за уровень).
export function levelSilMult(level: number): number {
  return 1 + (level - 1) * 0.1;
}

// Награды и стартовый баланс.
export const DAILY_REWARD = 50;
export const DAILY_COOLDOWN = 2 * 3_600_000; // награду можно забирать раз в 2 часа
export const START_COINS = 50;
// Версия разовой выдачи монет: повышай, чтобы один раз пополнить существующие сейвы до START_COINS.
export const GRANT_V = 1;
