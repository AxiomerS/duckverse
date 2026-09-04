// Квесты — задачи с наградой в Sil. Прогресс выводится из уже существующих полей сейва
// (без отдельного счётчика), поэтому новых полей почти не нужно — храним лишь список забранных.
// Квест — ГЛОБАЛЬНАЯ гонка: первый игрок, кто заявил награду, закрывает его для всех остальных
// (unique constraint на quest_id в public.quest_claims, см. marketplace.sql §8 + cloud.ts).
export type QuestMetric = "battleWins" | "level" | "bestScore" | "ownedPets" | "coins";

// reward — в ETH (валюта Robinhood Chain; своего токена у сети нет).
// Суммы ПЕРЕСЧИТАНЫ с прежних SOL-наград по соотношению цен ETH/SOL (~23×), чтобы награда осталась
// той же в долларах. Простая замена тикера сделала бы каждую выплату в 23 раза дороже для казны:
// было 0.05/0.08/0.03/0.04/0.05 SOL ≈ $5.25/$8.40/$3.15/$4.20/$5.25.
export const QUESTS = [
  { id: "q-battles", emoji: "⚔️", label: "Win 5 arena battles", metric: "battleWins", goal: 5, reward: 0.002 },
  { id: "q-level", emoji: "⭐", label: "Reach level 8", metric: "level", goal: 8, reward: 0.0035 },
  // Возвращено на 30000: трек теперь в 2 раза длиннее (300 нот вместо 150), так что даже с учётом
  // множителя комбо потолок результата вырос вместе с длиной — 30000 больше не требует безупречной игры.
  { id: "q-score", emoji: "🎵", label: "Score 30000 in a run", metric: "bestScore", goal: 30000, reward: 0.0013 },
  // Было id "q-collect" — заменили на новый id, старая заявка застряла закрытой и не сбрасывалась
  // (заявка на неё в quest_claims постоянно возрождалась из-за автосейва клиента со старым
  // локальным состоянием). Новый id = чистый лист, без всякой истории в базе.
  { id: "q-collect-v2", emoji: "🐣", label: "Own 4 ducks", metric: "ownedPets", goal: 4, reward: 0.0017 },
  { id: "q-rich", emoji: "🪙", label: "Hold 2500 DC", metric: "coins", goal: 2500, reward: 0.002 },
] as const;

export type Quest = (typeof QUESTS)[number];
