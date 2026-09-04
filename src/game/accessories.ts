import { type Rarity, RARITY_BONUS } from "./rarity";

// Аксессуары в духе ивента «Customize your MicroDuck»: утка носит их НА СЕБЕ (см. PetArt).
// Четыре слота — head / jacket / toy / boots, в каждом по 7 вариантов, включая ровно ДВА mythic.
// Выпадают только из сундуков.
//
// ВАЖНО: `id` менять НЕЛЬЗЯ — они лежат в сейвах (`ownedAccessories` и надетое на каждой утке)
// и переезжают вместе с уткой при продаже на маркетплейсе. `type`, `label` и `emoji` — свободны:
// они нигде не сохраняются и не ходят на сервер.
export const ACCESSORIES = [
  // head — садится на купол
  { id: "cap", type: "head", emoji: "🧢", label: "Cap", rarity: "rare" },
  { id: "grad-cap", type: "head", emoji: "🎓", label: "Grad Cap", rarity: "epic" },
  { id: "bow", type: "head", emoji: "🎧", label: "Headphones", rarity: "epic" },
  { id: "sun-hat", type: "head", emoji: "👒", label: "Sun Hat", rarity: "legendary" },
  { id: "helmet", type: "head", emoji: "⛑️", label: "Safety Helmet", rarity: "legendary" },
  { id: "top-hat", type: "head", emoji: "🎩", label: "Top Hat", rarity: "mythic" },
  { id: "crown", type: "head", emoji: "👑", label: "Crown", rarity: "mythic" },
  // jacket — на корпус
  { id: "leash", type: "jacket", emoji: "🧥", label: "Denim Jacket", rarity: "rare" },
  { id: "string-leash", type: "jacket", emoji: "🧣", label: "Scarf", rarity: "epic" },
  { id: "bell-collar", type: "jacket", emoji: "🎀", label: "Bow Tie", rarity: "epic" },
  { id: "ribbon-leash", type: "jacket", emoji: "🦺", label: "Hi-Vis Vest", rarity: "legendary" },
  { id: "bone-tag", type: "jacket", emoji: "🥼", label: "Lab Coat", rarity: "legendary" },
  { id: "chain-leash", type: "jacket", emoji: "🦸", label: "Hero Cape", rarity: "mythic" },
  { id: "rainbow-leash", type: "jacket", emoji: "🌈", label: "Rainbow Poncho", rarity: "mythic" },
  // toy — стоит рядом с уткой
  { id: "ball", type: "toy", emoji: "🦆", label: "Rubber Duck", rarity: "rare" },
  { id: "soccer", type: "toy", emoji: "⚽", label: "Soccer Ball", rarity: "epic" },
  { id: "yarn", type: "toy", emoji: "🧵", label: "Cable Spool", rarity: "epic" },
  { id: "teddy", type: "toy", emoji: "🧸", label: "Teddy", rarity: "legendary" },
  { id: "balloon", type: "toy", emoji: "🎈", label: "Balloon", rarity: "legendary" },
  { id: "game-toy", type: "toy", emoji: "🎮", label: "Game Pad", rarity: "mythic" },
  { id: "target-toy", type: "toy", emoji: "🛹", label: "Skateboard", rarity: "mythic" },
  // boots — поверх фирменных оранжевых ботов
  { id: "sneakers", type: "boots", emoji: "👟", label: "Sneakers", rarity: "rare" },
  { id: "boots", type: "boots", emoji: "👢", label: "Rain Boots", rarity: "epic" },
  { id: "loafers", type: "boots", emoji: "👞", label: "Loafers", rarity: "epic" },
  { id: "hiking", type: "boots", emoji: "🥾", label: "Hiking Boots", rarity: "legendary" },
  { id: "socks", type: "boots", emoji: "🧦", label: "Cozy Socks", rarity: "legendary" },
  { id: "heels", type: "boots", emoji: "👠", label: "Glass Heels", rarity: "mythic" },
  { id: "skates", type: "boots", emoji: "⛸️", label: "Ice Skates", rarity: "mythic" },
] as const;

export const accById = (id: string) => ACCESSORIES.find((a) => a.id === id);

// Утки стартуют БЕЗ аксессуаров — все выигрываются из сундуков.
export const STARTER_ACCESSORIES: string[] = [];

// Четыре слота под уткой, с блёклым «призрачным» значком, когда пусто.
export const SLOTS = [
  { type: "head", label: "Head", ghost: "🧢" },
  { type: "jacket", label: "Jacket", ghost: "🧥" },
  { type: "toy", label: "Toy", ghost: "🧸" },
  { type: "boots", label: "Boots", ghost: "👢" },
] as const;

// Постоянные бонусы от надетого: head→XP, jacket→голод, toy→счастье, boots→дейлик.
export function equippedBonuses(accessories: string[]): { xpMult: number; fDecay: number; hDecay: number; daily: number } {
  let xpMult = 0, fDecay = 0, hDecay = 0, daily = 0;
  for (const id of accessories) {
    const a = accById(id);
    if (!a) continue;
    const v = RARITY_BONUS[a.rarity];
    if (a.type === "head") xpMult += v;
    else if (a.type === "jacket") fDecay += v;
    else if (a.type === "toy") hDecay += v;
    else if (a.type === "boots") daily += v;
  }
  return { xpMult, fDecay, hDecay, daily };
}

// Человекочитаемое описание постоянного бонуса аксессуара.
// Legendary-аксессуары также дают ×1.5 пассивного DC (по одному на тип).
export function accDesc(type: string, rarity: Rarity): string {
  // MYTHIC-аксессуары используют концепцию "Living Relic" — регенерация, а не просто %.
  if (rarity === "mythic") {
    if (type === "head") return "🌟 Living Relic: passive XP over time";
    if (type === "jacket") return "🌟 Living Relic: fullness regenerates";
    if (type === "toy") return "🌟 Living Relic: happiness regenerates";
    return "🌟 Living Relic: bonus passive DC/min";
  }
  const pct = Math.round(RARITY_BONUS[rarity] * 100);
  let base: string;
  if (type === "head") base = `+${pct}% XP from food`;
  else if (type === "jacket") base = `−${pct}% hunger decay`;
  else if (type === "toy") base = `−${pct}% happiness decay`;
  else base = `+${pct}% daily reward`;
  if (rarity === "legendary") base += " · ×1.5 DC/min";
  return base;
}

// MYTHIC-концепция "Living Relic": вместо простого замедления распада mythic-аксессуар
// заставляет свой стат РЕГЕНЕРИРОВАТЬ со временем. jacket→fullness, toy→happiness (в час);
// head→пассивный XP/час; boots→плоский бонус DC/мин.
export function mythicAcc(accessories: string[]): { fRegen: number; hRegen: number; xpHr: number; silFlat: number } {
  let fRegen = 0, hRegen = 0, xpHr = 0, silFlat = 0;
  for (const id of accessories) {
    const a = accById(id);
    if (!a || a.rarity !== "mythic") continue;
    if (a.type === "jacket") fRegen += 30;
    else if (a.type === "toy") hRegen += 30;
    else if (a.type === "head") xpHr += 15;
    else if (a.type === "boots") silFlat += 5;
  }
  return { fRegen, hRegen, xpHr, silFlat };
}
