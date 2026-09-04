// Зелья — расходники из магазина, дающие ВРЕМЕННЫЕ бонусы (в отличие от еды, которая
// восстанавливает статы). Эффекты в долях: например sil 0.5 = +50% к пассивному Sil/мин.
// У зелий НЕТ редкости — все они «особые», продаются в магазине.
export type PotionEffect = { sil?: number; power?: number; decay?: number; xp?: number; daily?: number };

export const POTIONS = [
  { id: "sil-elixir", emoji: "🧪", label: "DC Elixir", cost: 120, durationMs: 30 * 60000, effect: { sil: 0.5 }, desc: "+50% DC/min" },
  { id: "power-brew", emoji: "⚗️", label: "Power Brew", cost: 150, durationMs: 30 * 60000, effect: { power: 0.3 }, desc: "+30% Arena power" },
  { id: "vitality-tonic", emoji: "🍶", label: "Vitality Tonic", cost: 100, durationMs: 60 * 60000, effect: { decay: 0.6 }, desc: "−60% stat decay" },
  { id: "wisdom-draught", emoji: "🍵", label: "Wisdom Draught", cost: 110, durationMs: 30 * 60000, effect: { xp: 0.6 }, desc: "+60% XP from food" },
  { id: "fortune-flask", emoji: "🍹", label: "Fortune Flask", cost: 130, durationMs: 45 * 60000, effect: { sil: 0.25, xp: 0.25 }, desc: "+25% DC/min & XP" },
] as const;

export type Potion = (typeof POTIONS)[number];
export const potionById = (id: string) => POTIONS.find((p) => p.id === id);

// Активное зелье, надетое на питомца (истекает по времени).
export type ActivePotion = { id: string; expiresAt: number };

// Полная подсказка для зелья: эффект + длительность.
export function potionTitle(p: Potion): string {
  return `${p.desc} for ${Math.round(p.durationMs / 60000)}m`;
}

// Суммарные эффекты всех активных (не истёкших) зелий.
export function potionEffects(active: ActivePotion[], now: number): { sil: number; power: number; decay: number; xp: number; daily: number } {
  const e = { sil: 0, power: 0, decay: 0, xp: 0, daily: 0 };
  for (const a of active) {
    if (a.expiresAt <= now) continue;
    const p = potionById(a.id);
    if (!p) continue;
    const ef = p.effect as PotionEffect;
    e.sil += ef.sil ?? 0;
    e.power += ef.power ?? 0;
    e.decay += ef.decay ?? 0;
    e.xp += ef.xp ?? 0;
    e.daily += ef.daily ?? 0;
  }
  e.decay = Math.min(0.9, e.decay); // снижение распада не больше 90%
  return e;
}
