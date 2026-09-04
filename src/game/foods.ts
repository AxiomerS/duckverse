import { type Rarity, XP_BY_RARITY, rollRarity } from "./rarity";
import { BUFFS, type BuffKind } from "./buffs";

// Еда. cost в Sil; эффекты на статы питомца; rarity задаёт дроп из сундуков и цвет.
export const FOODS = [
  // common
  { id: "berry", emoji: "🍓", label: "Berry", cost: 6, fullness: 8, happiness: 8, rarity: "common" },
  { id: "carrot", emoji: "🥕", label: "Carrot", cost: 8, fullness: 15, happiness: 2, rarity: "common" },
  { id: "banana", emoji: "🍌", label: "Banana", cost: 9, fullness: 18, happiness: 4, rarity: "common" },
  { id: "snack", emoji: "🍪", label: "Snack", cost: 10, fullness: 20, happiness: 0, rarity: "common" },
  { id: "apple", emoji: "🍎", label: "Apple", cost: 12, fullness: 25, happiness: 3, rarity: "common" },
  // rare
  { id: "cake", emoji: "🍰", label: "Cake", cost: 16, fullness: 10, happiness: 28, rarity: "rare" },
  { id: "donut", emoji: "🍩", label: "Donut", cost: 18, fullness: 12, happiness: 25, rarity: "rare" },
  { id: "pizza", emoji: "🍕", label: "Pizza", cost: 22, fullness: 35, happiness: 12, rarity: "rare" },
  { id: "burger", emoji: "🍔", label: "Burger", cost: 24, fullness: 40, happiness: 10, rarity: "rare" },
  { id: "meal", emoji: "🍖", label: "Meal", cost: 25, fullness: 45, happiness: 5, rarity: "rare" },
  // epic
  { id: "steak", emoji: "🥩", label: "Steak", cost: 32, fullness: 60, happiness: 8, rarity: "epic" },
  { id: "sushi", emoji: "🍣", label: "Sushi", cost: 38, fullness: 40, happiness: 30, rarity: "epic" },
  { id: "ramen", emoji: "🍜", label: "Ramen", cost: 40, fullness: 50, happiness: 20, rarity: "epic" },
  { id: "taco", emoji: "🌮", label: "Taco Plate", cost: 48, fullness: 55, happiness: 18, rarity: "epic" },
  { id: "bento", emoji: "🍱", label: "Bento", cost: 55, fullness: 65, happiness: 22, rarity: "epic" },
  // legendary (даёт временный бафф)
  { id: "hotpot", emoji: "🍲", label: "Hotpot", cost: 88, fullness: 75, happiness: 42, rarity: "legendary" },
  { id: "roast", emoji: "🍗", label: "Roast Chicken", cost: 92, fullness: 80, happiness: 30, rarity: "legendary" },
  { id: "lobster", emoji: "🦞", label: "Lobster", cost: 95, fullness: 85, happiness: 35, rarity: "legendary" },
  // mythic (лучший бафф)
  { id: "honey", emoji: "🍯", label: "Golden Honey", cost: 150, fullness: 55, happiness: 100, rarity: "mythic" },
  { id: "feast", emoji: "🎂", label: "Royal Feast", cost: 160, fullness: 100, happiness: 70, rarity: "mythic" },
] as const;

export type Food = (typeof FOODS)[number];

// Прибавка боевой силы (Игра №2) от еды по редкости, В ДОЛЯХ: epic +10%, legendary +20%, mythic +35%.
export const FOOD_POWER: Record<Rarity, number> = { common: 0, rare: 0, epic: 0.1, legendary: 0.2, mythic: 0.35 };

// Бафф конкретной еды (у каждой легендарной/мистической — свой).
export const FOOD_BUFF: Partial<Record<string, BuffKind>> = {
  hotpot: "energized",
  roast: "joyful",
  lobster: "hearty",
  honey: "golden",
  feast: "feasted",
};

// Сундук еды: платим Sil, кидаем редкость по шансам сундука, затем случайную еду этой редкости.
export function rollFood(odds: Partial<Record<Rarity, number>>): Food {
  const rarity = rollRarity(odds);
  const pool = FOODS.filter((f) => f.rarity === rarity);
  const from = pool.length ? pool : FOODS;
  return from[Math.floor(Math.random() * from.length)];
}

// Текст подсказки для еды: статы, XP и (для legendary+) временный бафф.
export function foodTitle(food: Food): string {
  const bk = FOOD_BUFF[food.id];
  const m = bk ? BUFFS[bk] : null;
  const xp = XP_BY_RARITY[food.rarity];
  if (food.rarity === "mythic") {
    return `Fully restores ALL stats${m ? ` · ${m.emoji} ${m.label} for ${Math.round(m.durationMs / 60000)}m` : ""} · ⚔️ +${Math.round(FOOD_POWER.mythic * 100)}% power (Arena) · +${xp} XP`;
  }
  const pw = FOOD_POWER[food.rarity];
  const pwTxt = pw > 0 ? ` · ⚔️ +${Math.round(pw * 100)}% power (Arena) for 60m` : "";
  const base = `+${food.fullness} fullness · +${food.happiness} happy · +${xp} XP${pwTxt}`;
  if (!m) return base;
  return `${base} · ${m.emoji} ${m.label}: slower decay for ${Math.round(m.durationMs / 60000)}m`;
}
