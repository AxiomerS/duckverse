// Квесты — задачи с наградой в DC. Прогресс выводится из уже существующих полей сейва
// (без отдельного счётчика), поэтому новых полей почти не нужно — храним лишь список забранных.
// С 7 сентября 2026 квест ЛИЧНЫЙ: каждый игрок закрывает каждый квест один раз, награду начисляет
// сервер (edge fn pv, действие quest, SQL pv_quest_claim, marketplace.sql §12). Сервер сверяет
// прогресс по своим таблицам там, где может (баланс, леджер уток, рекорды, арена, сейв).
export type QuestMetric = "battleWins" | "level" | "bestScore" | "ownedPets" | "coins";

// Награда в DC. Суммы пересчитаны из прежних ETH-наград по курсу покупки 1 ETH = 180 000 DC
// (ETH_PV_RATE): 0.002/0.0035/0.0013/0.0017/0.002 ETH = 360/630/234/306/360 DC, округлено.
// Держать в синхроне с QUEST_DEFS в edge fn pv: сервер начисляет СВОЮ таблицу, клиент только показывает.
export const QUEST_CURRENCY = "DC";
export const QUESTS = [
  { id: "q-battles", emoji: "⚔️", label: "Win 5 arena battles", metric: "battleWins", goal: 5, reward: 350 },
  { id: "q-level", emoji: "⭐", label: "Reach level 8", metric: "level", goal: 8, reward: 650 },
  // Возвращено на 30000: трек теперь в 2 раза длиннее (300 нот вместо 150), так что даже с учётом
  // множителя комбо потолок результата вырос вместе с длиной — 30000 больше не требует безупречной игры.
  { id: "q-score", emoji: "🎵", label: "Score 30000 in a run", metric: "bestScore", goal: 30000, reward: 250 },
  // Было id "q-collect" — заменили на новый id, старая заявка застряла закрытой и не сбрасывалась
  // (заявка на неё в quest_claims постоянно возрождалась из-за автосейва клиента со старым
  // локальным состоянием). Новый id = чистый лист, без всякой истории в базе.
  { id: "q-collect-v2", emoji: "🐣", label: "Own 4 ducks", metric: "ownedPets", goal: 4, reward: 300 },
  { id: "q-rich", emoji: "🪙", label: "Hold 2500 DC", metric: "coins", goal: 2500, reward: 350 },
] as const;

export type Quest = (typeof QUESTS)[number];
