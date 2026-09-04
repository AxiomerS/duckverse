import { type Rarity, RARITY_BONUS } from "./rarity";

// Аксессуары — четыре типа (cap / leash / toy / boots). У каждого типа несколько
// вариантов по редкости, включая ровно ДВА mythic. Выпадают только из сундуков.
export const ACCESSORIES = [
  // caps
  { id: "cap", type: "cap", emoji: "🧢", label: "Cap", rarity: "rare" },
  { id: "grad-cap", type: "cap", emoji: "🎓", label: "Grad Cap", rarity: "epic" },
  { id: "bow", type: "cap", emoji: "🎀", label: "Bow", rarity: "epic" },
  { id: "sun-hat", type: "cap", emoji: "👒", label: "Sun Hat", rarity: "legendary" },
  { id: "helmet", type: "cap", emoji: "⛑️", label: "Helmet", rarity: "legendary" },
  { id: "top-hat", type: "cap", emoji: "🎩", label: "Top Hat", rarity: "mythic" },
  { id: "crown", type: "cap", emoji: "👑", label: "Crown", rarity: "mythic" },
  // leashes
  { id: "leash", type: "leash", emoji: "🔗", label: "Leash", rarity: "rare" },
  { id: "string-leash", type: "leash", emoji: "🧵", label: "String Leash", rarity: "epic" },
  { id: "bell-collar", type: "leash", emoji: "🔔", label: "Bell Collar", rarity: "epic" },
  { id: "ribbon-leash", type: "leash", emoji: "🎗️", label: "Ribbon Leash", rarity: "legendary" },
  { id: "bone-tag", type: "leash", emoji: "🦴", label: "Bone Tag", rarity: "legendary" },
  { id: "chain-leash", type: "leash", emoji: "⛓️", label: "Chain Leash", rarity: "mythic" },
  { id: "rainbow-leash", type: "leash", emoji: "🌈", label: "Rainbow Leash", rarity: "mythic" },
  // toys
  { id: "ball", type: "toy", emoji: "🎾", label: "Ball", rarity: "rare" },
  { id: "soccer", type: "toy", emoji: "⚽", label: "Soccer Ball", rarity: "epic" },
  { id: "yarn", type: "toy", emoji: "🧶", label: "Yarn Ball", rarity: "epic" },
  { id: "teddy", type: "toy", emoji: "🧸", label: "Teddy", rarity: "legendary" },
  { id: "balloon", type: "toy", emoji: "🎈", label: "Balloon", rarity: "legendary" },
  { id: "game-toy", type: "toy", emoji: "🎮", label: "Game Toy", rarity: "mythic" },
  { id: "target-toy", type: "toy", emoji: "🎯", label: "Target Toy", rarity: "mythic" },
  // boots
  { id: "sneakers", type: "boots", emoji: "👟", label: "Sneakers", rarity: "rare" },
  { id: "boots", type: "boots", emoji: "👢", label: "Boots", rarity: "epic" },
  { id: "loafers", type: "boots", emoji: "👞", label: "Loafers", rarity: "epic" },
  { id: "hiking", type: "boots", emoji: "🥾", label: "Hiking Boots", rarity: "legendary" },
  { id: "socks", type: "boots", emoji: "🧦", label: "Cozy Socks", rarity: "legendary" },
  { id: "heels", type: "boots", emoji: "👠", label: "Glass Heels", rarity: "mythic" },
  { id: "skates", type: "boots", emoji: "⛸️", label: "Ice Skates", rarity: "mythic" },
] as const;

export const accById = (id: string) => ACCESSORIES.find((a) => a.id === id);

// Питомцы стартуют БЕЗ аксессуаров — все выигрываются из сундуков.
export const STARTER_ACCESSORIES: string[] = [];

// Четыре слота аксессуаров под питомцем, с блёклым "призрачным" значком, когда пусто.
export const SLOTS = [
  { type: "cap", label: "Cap", ghost: "🧢" },
  { type: "leash", label: "Leash", ghost: "🔗" },
  { type: "toy", label: "Toy", ghost: "🧸" },
  { type: "boots", label: "Boots", ghost: "👢" },
] as const;

// Постоянные бонусы от надетых аксессуаров: cap→XP, leash→голод, toy→счастье, boots→дейлик.
export function equippedBonuses(accessories: string[]): { xpMult: number; fDecay: number; hDecay: number; daily: number } {
  let xpMult = 0, fDecay = 0, hDecay = 0, daily = 0;
  for (const id of accessories) {
    const a = accById(id);
    if (!a) continue;
    const v = RARITY_BONUS[a.rarity];
    if (a.type === "cap") xpMult += v;
    else if (a.type === "leash") fDecay += v;
    else if (a.type === "toy") hDecay += v;
    else if (a.type === "boots") daily += v;
  }
  return { xpMult, fDecay, hDecay, daily };
}

// Человекочитаемое описание постоянного бонуса аксессуара.
// Legendary-аксессуары также дают ×1.5 пассивного Sil (по одному на тип).
export function accDesc(type: string, rarity: Rarity): string {
  // MYTHIC-аксессуары используют концепцию "Living Relic" — регенерация, а не просто %.
  if (rarity === "mythic") {
    if (type === "cap") return "🌟 Living Relic: passive XP over time";
    if (type === "leash") return "🌟 Living Relic: fullness regenerates";
    if (type === "toy") return "🌟 Living Relic: happiness regenerates";
    return "🌟 Living Relic: bonus passive DC/min";
  }
  const pct = Math.round(RARITY_BONUS[rarity] * 100);
  let base: string;
  if (type === "cap") base = `+${pct}% XP from food`;
  else if (type === "leash") base = `−${pct}% hunger decay`;
  else if (type === "toy") base = `−${pct}% happiness decay`;
  else base = `+${pct}% daily reward`;
  if (rarity === "legendary") base += " · ×1.5 DC/min";
  return base;
}

// MYTHIC-концепция "Living Relic": вместо простого замедления распада mythic-аксессуар
// заставляет свой стат РЕГЕНЕРИРОВАТЬ со временем. leash→fullness, toy→happiness (в час);
// cap→пассивный XP/час; boots→плоский бонус Sil/мин.
export function mythicAcc(accessories: string[]): { fRegen: number; hRegen: number; xpHr: number; silFlat: number } {
  let fRegen = 0, hRegen = 0, xpHr = 0, silFlat = 0;
  for (const id of accessories) {
    const a = accById(id);
    if (!a || a.rarity !== "mythic") continue;
    if (a.type === "leash") fRegen += 30;
    else if (a.type === "toy") hRegen += 30;
    else if (a.type === "cap") xpHr += 15;
    else if (a.type === "boots") silFlat += 5;
  }
  return { fRegen, hRegen, xpHr, silFlat };
}
