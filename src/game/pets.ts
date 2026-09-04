// Модели робо-уток. Арт — рендеры Microduck в components/PetArt.tsx, эмодзи остаётся фолбэком.
// Три обычные модели доступны на старте; более редкие приходят из Pet Chest.
// Редкость модели даёт постоянный бонус, когда утка активна.
// ВАЖНО: id НЕ переименовываем (это ключи сейвов, pet_ledger и маркетплейса) — меняются только вывеска и арт.
export const PETS = [
  { id: "dog", emoji: "🦆", label: "Cream Duck", rarity: "common" },
  { id: "cat", emoji: "🦆", label: "Graphite Duck", rarity: "common" },
  { id: "hamster", emoji: "🦆", label: "Sky Duck", rarity: "common" },
  { id: "rabbit", emoji: "🦆", label: "Lavender Duck", rarity: "rare" },
  { id: "frog", emoji: "🌱", label: "Moss Duck", rarity: "rare" },
  { id: "penguin", emoji: "❄️", label: "Frost Duck", rarity: "rare" },
  { id: "fox", emoji: "🔥", label: "Ember Duck", rarity: "epic" },
  { id: "panda", emoji: "🎩", label: "Tuxedo Duck", rarity: "epic" },
  { id: "owl", emoji: "🌙", label: "Night Duck", rarity: "epic" },
  { id: "lion", emoji: "⚙️", label: "Chrome Duck", rarity: "legendary" },
  { id: "tiger", emoji: "⚡", label: "Volt Duck", rarity: "legendary" },
  { id: "unicorn", emoji: "🌈", label: "Prism Duck", rarity: "legendary" },
  { id: "dragon", emoji: "👑", label: "Golden Duck", rarity: "mythic" },
  { id: "dino", emoji: "♾️", label: "Eternal Duck", rarity: "mythic" },
] as const;

export type PetId = (typeof PETS)[number]["id"];
export const petById = (id: string) => PETS.find((p) => p.id === id);
// Базовые (обычные) питомцы — стартовые dog/cat/hamster. Они НЕ могут умереть
// (не уходят в обморок): их здоровье может упасть, но экрана смерти для них нет.
export const isBasePet = (id: string): boolean => petById(id)?.rarity === "common";
// На экране создания предлагаются только обычные виды.
export const STARTER_PETS = PETS.filter((p) => p.rarity === "common");

// У каждого вида ОДИН уникальный перк. Стартовые обычные (dog/cat/hamster) НЕ имеют перка —
// бонусы есть только у питомцев, которых выбивают из сундука (rare и выше).
// Mythic-питомцы получают флагманские перки.
export type PerkKind = "xp" | "sil" | "daily" | "shop" | "acc" | "food" | "decay" | "hunger" | "happy" | "hoard" | "eternal";
export const SPECIES_PERK: Record<string, { kind: PerkKind; value: number; label: string }> = {
  rabbit: { kind: "hunger", value: 0.15, label: "−15% hunger decay" },
  frog: { kind: "food", value: 0.2, label: "+20% food effect" },
  penguin: { kind: "daily", value: 0.2, label: "+20% daily reward" },
  fox: { kind: "shop", value: 0.1, label: "−10% shop prices" },
  panda: { kind: "decay", value: 0.15, label: "−15% all decay" },
  owl: { kind: "xp", value: 0.3, label: "+30% XP from food" },
  lion: { kind: "acc", value: 0.3, label: "+30% accessory bonuses" },
  tiger: { kind: "sil", value: 0.4, label: "+40% DC/min" },
  unicorn: { kind: "daily", value: 0.4, label: "+40% daily reward" },
  // MYTHIC флагманские перки — целый новый уровень мощи:
  dragon: { kind: "hoard", value: 1, label: "👑 Golden Hoard: ×2 ALL DC income · −25% shop" },
  dino: { kind: "eternal", value: 1, label: "♾️ Eternal Core: stats never decay" },
};

// Развернуть перк активного вида в каналы эффектов.
export function speciesEffect(speciesId: string) {
  const e = { xp: 0, sil: 0, daily: 0, shop: 0, acc: 0, food: 0, decayF: 0, decayH: 0 };
  const p = SPECIES_PERK[speciesId];
  if (!p) return e;
  if (p.kind === "xp") e.xp = p.value;
  else if (p.kind === "sil") e.sil = p.value;
  else if (p.kind === "daily") e.daily = p.value;
  else if (p.kind === "shop") e.shop = p.value;
  else if (p.kind === "acc") e.acc = p.value;
  else if (p.kind === "food") e.food = p.value;
  else if (p.kind === "decay") { e.decayF = p.value; e.decayH = p.value; }
  else if (p.kind === "hunger") e.decayF = p.value;
  else if (p.kind === "happy") e.decayH = p.value;
  else if (p.kind === "hoard") { e.sil = 1; e.daily = 0.5; e.shop = 0.25; } // ×2 sil, +50% daily, −25% shop
  else if (p.kind === "eternal") { e.decayF = 1; e.decayH = 1; } // без распада
  return e;
}
