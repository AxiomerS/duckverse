// Квесты — задачи с наградой в Sil. Прогресс выводится из уже существующих полей сейва
// (без отдельного счётчика), поэтому новых полей почти не нужно — храним лишь список забранных.
// Квест — ГЛОБАЛЬНАЯ гонка: первый игрок, кто заявил награду, закрывает его для всех остальных
// (unique constraint на quest_id в public.quest_claims, см. marketplace.sql §8 + cloud.ts).
export type QuestMetric = "battleWins" | "level" | "bestScore" | "ownedPets" | "coins";

// Награды за квесты выплачиваются вручную админом (панель Payout requests, кнопка Mark paid),
// поэтому валюта тут только подпись и число: цепочка и edge-функции в квестах не участвуют.
// С 7 сентября 2026 награда в NVDA, токенизированной акции на Robinhood Chain. Суммы пересчитаны
// из прежних ETH-наград по курсу на 7 сентября 2026 (ETH $2508, NVDA $230.36, 1 NVDA ≈ 0.0918 ETH),
// чтобы награда осталась той же в долларах: было 0.002/0.0035/0.0013/0.0017/0.002 ETH.
export const QUEST_CURRENCY = "NVDA";
export const QUESTS = [
  { id: "q-battles", emoji: "⚔️", label: "Win 5 arena battles", metric: "battleWins", goal: 5, reward: 0.022 },
  { id: "q-level", emoji: "⭐", label: "Reach level 8", metric: "level", goal: 8, reward: 0.038 },
  // Возвращено на 30000: трек теперь в 2 раза длиннее (300 нот вместо 150), так что даже с учётом
  // множителя комбо потолок результата вырос вместе с длиной — 30000 больше не требует безупречной игры.
  { id: "q-score", emoji: "🎵", label: "Score 30000 in a run", metric: "bestScore", goal: 30000, reward: 0.014 },
  // Было id "q-collect" — заменили на новый id, старая заявка застряла закрытой и не сбрасывалась
  // (заявка на неё в quest_claims постоянно возрождалась из-за автосейва клиента со старым
  // локальным состоянием). Новый id = чистый лист, без всякой истории в базе.
  { id: "q-collect-v2", emoji: "🐣", label: "Own 4 ducks", metric: "ownedPets", goal: 4, reward: 0.019 },
  { id: "q-rich", emoji: "🪙", label: "Hold 2500 DC", metric: "coins", goal: 2500, reward: 0.022 },
] as const;

export type Quest = (typeof QUESTS)[number];
