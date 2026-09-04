import { petById } from "../game/pets";

// ===== Арт робо-уток =====
// Основа — 4 рендера Microduck (Pollen Robotics) из прототипа Duckverse: cream / graphite /
// lavender / sky, все ростом 420px в public/ducks/. Остальные 10 видов получаются
// CSS-перекраской того же рендера (hue-rotate/saturate/...), поэтому вся коллекция
// выглядит как один модельный ряд, а не как набор из разных источников.
// Кредит на арт есть в футере игры (App.tsx).

type DuckSkin = { base: "cream" | "graphite" | "lavender" | "sky"; filter?: string };

// ID видов НЕ переименовываем — это ключи сейвов, pet_ledger и маркетплейса.
const DUCKS: Record<string, DuckSkin> = {
  // --- common: стартовые — четыре «родных» цвета без перекраски ---
  dog: { base: "cream" },                 // Cream Duck
  cat: { base: "graphite" },              // Graphite Duck
  hamster: { base: "sky" },               // Sky Duck

  // --- rare ---
  rabbit: { base: "lavender" },           // Lavender Duck — четвёртый «родной» цвет
  frog: { base: "cream", filter: "hue-rotate(95deg) saturate(1.25)" },                        // Moss Duck
  penguin: { base: "cream", filter: "hue-rotate(168deg) saturate(.85) brightness(1.12)" },    // Frost Duck

  // --- epic ---
  fox: { base: "cream", filter: "hue-rotate(-26deg) saturate(1.75)" },                        // Ember Duck
  panda: { base: "graphite", filter: "grayscale(1) contrast(1.3) brightness(1.12)" },         // Tuxedo Duck
  owl: { base: "lavender", filter: "saturate(2.1) brightness(.68) contrast(1.15)" },          // Night Duck

  // --- legendary ---
  lion: { base: "cream", filter: "grayscale(1) brightness(1.18) contrast(1.08)" },            // Chrome Duck
  tiger: { base: "graphite", filter: "hue-rotate(14deg) saturate(2.3) brightness(1.16)" },    // Volt Duck
  unicorn: { base: "cream", filter: "hue-rotate(285deg) saturate(1.5) brightness(1.05)" },    // Prism Duck

  // --- mythic ---
  dragon: { base: "cream", filter: "sepia(1) saturate(3.2) hue-rotate(-12deg) brightness(1.05)" }, // Golden Duck
  dino: { base: "graphite", filter: "hue-rotate(140deg) saturate(1.9) brightness(.95)" },          // Eternal Duck
};

// Показать утку: рендер с перекраской → эмодзи (фолбэк для видов без палитры).
export function PetArt({ species, size = 64, className }: { species: string; size?: number; className?: string }) {
  const skin = DUCKS[species];
  if (skin) {
    return (
      <img
        className={className}
        src={`/ducks/${skin.base}.webp`}
        width={size}
        height={size}
        alt={petById(species)?.label ?? species}
        // Все рендеры одной высоты (420px), поэтому object-fit: contain даёт всем видам
        // одинаковый масштаб — утки в списке не «прыгают» по размеру.
        style={{ display: "block", objectFit: "contain", filter: skin.filter }}
        draggable={false}
      />
    );
  }
  return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{petById(species)?.emoji ?? "🦆"}</span>;
}
