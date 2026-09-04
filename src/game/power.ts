import { type Rarity } from "./rarity";
import { accById } from "./accessories";

// Боевые показатели для Игры №2 (PvP-бой питомцев).
// Весь урон (сила) снижен ещё в 1.5 раза поверх более раннего снижения в 1.2 раза (итого ×1/1.8 от
// исходных значений: было 50/10; rare-mythic 20/40/65/95 и 15/30/53/90) — HP не трогали.
export const BASE_POWER = 28;
export const POWER_PER_LEVEL = 5; // уровень повышает силу
export const BASE_HP = 300;
export const HP_PER_LEVEL = 20; // уровень повышает HP
export const CRIT_CAP = 0.25; // суммарный шанс крита не выше 25%

// Сила и HP от надетого аксессуара по редкости.
const ACC_POWER: Record<Rarity, number> = { common: 0, rare: 9, epic: 17, legendary: 29, mythic: 50 };
const ACC_HP: Record<Rarity, number> = { common: 0, rare: 75, epic: 150, legendary: 270, mythic: 450 };

// Бонус к силе/HP от редкости САМОГО ВИДА питомца (не аксессуаров) — более редкие виды базово крепче.
const RARITY_POWER: Record<Rarity, number> = { common: 0, rare: 11, epic: 22, legendary: 36, mythic: 53 };
const RARITY_HP: Record<Rarity, number> = { common: 0, rare: 80, epic: 140, legendary: 210, mythic: 280 };

// Модификатор крита (epic и выше): шанс крита и доп. урон крита (доля).
// dmg уменьшен в 2.5 раза (было epic .5/legendary .75/mythic 1.0) — шанс крита не тронут.
const ACC_CRIT: Partial<Record<Rarity, { chance: number; dmg: number }>> = {
  epic: { chance: 0.1, dmg: 0.2 },
  legendary: { chance: 0.15, dmg: 0.3 },
  mythic: { chance: 0.25, dmg: 0.4 },
};

export type Loadout = { power: number; hp: number; critChance: number; critMult: number };

// Итоговая «сборка»: сила (× бафф еды в %), HP, шанс и множитель крита.
// powerBuffPct — доля (например 0.2 = +20% к силе). rarity — редкость вида питомца (не аксессуаров).
export function loadoutPower(level: number, accessories: string[], powerBuffPct: number, rarity: Rarity): Loadout {
  let base = BASE_POWER + level * POWER_PER_LEVEL + RARITY_POWER[rarity];
  let hp = BASE_HP + level * HP_PER_LEVEL + RARITY_HP[rarity];
  const critChances: number[] = [];
  let dmg = 0;
  for (const id of accessories) {
    const a = accById(id);
    if (!a) continue;
    base += ACC_POWER[a.rarity];
    hp += ACC_HP[a.rarity];
    const c = ACC_CRIT[a.rarity];
    if (c) { critChances.push(c.chance); dmg += c.dmg; }
  }
  const power = Math.round(base * (1 + (powerBuffPct || 0)));
  // Крит складывается с уменьшающейся пользой: 1 − произведение(1 − cᵢ), но не выше CRIT_CAP.
  let noCrit = 1;
  for (const c of critChances) noCrit *= 1 - c;
  const critChance = Math.min(CRIT_CAP, 1 - noCrit);
  return { power, hp, critChance, critMult: 1 + dmg };
}

// Активная прибавка силы (в долях) от баффа еды, если ещё не истёк.
export function activePowerBuff(buff: { amount: number; expiresAt: number } | null | undefined, now: number): number {
  return buff && buff.expiresAt > now ? buff.amount : 0;
}

// Для показа в снаряжении.
export function accPower(rarity: Rarity): number {
  return ACC_POWER[rarity];
}
export function accHp(rarity: Rarity): number {
  return ACC_HP[rarity];
}
export function accCrit(rarity: Rarity): { chance: number; dmg: number } | null {
  return ACC_CRIT[rarity] ?? null;
}

// ===== Детерминированный бой для LIVE PvP =====
// Оба матченных игрока считают исход НЕЗАВИСИМО на своих клиентах (как и обычный бой — client-
// reported, см. CLAUDE.md), но должны получить ОДИНАКОВЫЙ результат. Поэтому вместо Math.random()
// используем seed-детерминированный ГСЧ: тот же seed (= хэш общего match_id) + те же характеристики
// обоих бойцов на входе → побитово идентичная последовательность ходов на обеих сторонах.

// mulberry32 — маленький детерминированный ГСЧ (32-битный seed → поток [0,1)).
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Строку (match_id) → 32-битное число (FNV-1a) — одинаково на обеих сторонах матча.
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type SimStep = { attacker: "A" | "B"; dmg: number; crit: boolean };

// Бойцы обозначены КАНОНИЧЕСКИ (A/B, не «я»/«соперник») — порядок определяет вызывающий код
// (например, по сравнению кошельков), чтобы оба клиента подставили одни и те же A/B на одни и те
// же роли. Возвращает всю последовательность ходов (для покадровой анимации) + итогового победителя.
export function simulateBattle(a: Loadout, b: Loadout, seed: number): { steps: SimStep[]; winner: "A" | "B" } {
  const rng = mulberry32(seed);
  let hpA = a.hp;
  let hpB = b.hp;
  let turnIsA = rng() < 0.5;
  const steps: SimStep[] = [];
  for (let i = 0; i < 500; i++) {
    const atk = turnIsA ? a : b;
    const crit = rng() < atk.critChance;
    const dmg = Math.round(atk.power * (crit ? atk.critMult : 1));
    if (turnIsA) hpB = Math.max(0, hpB - dmg);
    else hpA = Math.max(0, hpA - dmg);
    steps.push({ attacker: turnIsA ? "A" : "B", dmg, crit });
    if (hpA <= 0 || hpB <= 0) return { steps, winner: turnIsA ? "A" : "B" };
    turnIsA = !turnIsA;
  }
  return { steps, winner: hpA >= hpB ? "A" : "B" }; // защита от бесконечного цикла — практически недостижимо
}

// Какой аксессуар проигравшего достаётся победителю в LIVE-матче — детерминированно (отдельный
// seed от боевого, чтобы не путать потоки ГСЧ), так что и победитель, и ПРОИГРАВШИЙ независимо
// вычисляют один и тот же ответ на своих клиентах: победитель добавляет его себе, проигравший
// реально теряет его у себя (без него нечего было бы вычитать — иначе предмет "терялся" бы только
// на экране победителя, а у настоящего игрока-соперника оставался бы как ни в чём не бывало).
export function pickLootAccessory(loserAccessories: string[], matchId: string): string | null {
  if (!loserAccessories.length) return null;
  const rng = mulberry32(hashSeed(matchId + ":loot"));
  return loserAccessories[Math.floor(rng() * loserAccessories.length)];
}
