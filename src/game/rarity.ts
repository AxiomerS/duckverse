// Редкости предметов и питомцев — от обычного (common) к мифическому (mythic).
export const RARITY = {
  common: { label: "Common", color: "#9ca3af" },
  rare: { label: "Rare", color: "#5aa9ff" },
  epic: { label: "Epic", color: "#c084fc" },
  legendary: { label: "Legendary", color: "#ff7a45" },
  mythic: { label: "Mythic", color: "#ffa64d" },
} as const;
export type Rarity = keyof typeof RARITY;
export const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary", "mythic"];

// XP, который еда даёт при поедании, по редкости. Реже еда → больше XP.
export const XP_BY_RARITY: Record<Rarity, number> = { common: 5, rare: 10, epic: 20, legendary: 40, mythic: 80 };

// Сила бонуса (доля) по редкости — для постоянных перков аксессуаров и видов.
export const RARITY_BONUS: Record<Rarity, number> = { common: 0, rare: 0.05, epic: 0.1, legendary: 0.18, mythic: 0.3 };

// Выбрать редкость по взвешенным шансам (%). Отсутствующие тиры считаются 0.
export function rollRarity(odds: Partial<Record<Rarity, number>>): Rarity {
  let r = Math.random() * 100;
  for (const tier of RARITY_ORDER) {
    const w = odds[tier] ?? 0;
    if (r < w) return tier;
    r -= w;
  }
  return "common";
}
