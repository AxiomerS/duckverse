import { type Rarity } from "./rarity";

// Временные баффы от еды legendary+. Множитель < 1 замедляет распад этого стата.
// Mythic-еда → "Golden": НУЛЕВОЙ распад на час (и она же полностью восстанавливает статы).
export type BuffKind = "energized" | "joyful" | "hearty" | "golden" | "feasted" | "cuddled";
const HOUR = 60 * 60 * 1000;
export const BUFFS: Record<BuffKind, { label: string; emoji: string; durationMs: number; fullnessMult: number; happinessMult: number }> = {
  // legendary-еда — у каждой свой бафф:
  energized: { label: "Energized", emoji: "⚡", durationMs: HOUR, fullnessMult: 0.5, happinessMult: 1 }, // −50% распад сытости
  joyful: { label: "Joyful", emoji: "😄", durationMs: HOUR, fullnessMult: 1, happinessMult: 0.5 }, // −50% распад счастья
  hearty: { label: "Hearty", emoji: "💪", durationMs: HOUR, fullnessMult: 0.6, happinessMult: 0.6 }, // −40% оба
  // mythic-еда (вдобавок полностью восстанавливает статы):
  golden: { label: "Golden", emoji: "🌟", durationMs: HOUR, fullnessMult: 0, happinessMult: 0 }, // нулевой распад 1ч
  feasted: { label: "Feasted", emoji: "🍽️", durationMs: 2 * HOUR, fullnessMult: 0.5, happinessMult: 0.5 }, // −50% оба, 2ч
  // От «погладить»: −10% к распаду сытости и счастья на 1 час.
  cuddled: { label: "Cuddled", emoji: "🤚", durationMs: HOUR, fullnessMult: 0.9, happinessMult: 0.9 },
};
export function buffForRarity(r: Rarity): BuffKind | null {
  if (r === "legendary") return "energized";
  if (r === "mythic") return "golden";
  return null;
}

// Множители распада от сейчас активных баффов (минимум по всем баффам).
export function activeMult(buffs: { kind: BuffKind; expiresAt: number }[], now: number): { f: number; h: number } {
  let f = 1, h = 1;
  for (const b of buffs) {
    if (b.expiresAt <= now) continue;
    const m = BUFFS[b.kind];
    f = Math.min(f, m.fullnessMult);
    h = Math.min(h, m.happinessMult);
  }
  return { f, h };
}
