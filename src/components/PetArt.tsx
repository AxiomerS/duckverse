import { petById } from "../game/pets";
import { ACCESSORIES } from "../game/accessories";

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

// ===== Точки крепления аксессуаров =====
// Позы у четырёх рендеров разные: cream сидит, остальные стоят, и головы стоят в очень разных
// местах по ширине. Координаты сняты по альфа-каналу самих файлов, а не на глаз.
// Отсчёт — в процентах от КВАДРАТНОЙ коробки <img>. Все исходники высотой 420px и уже её, поэтому
// object-fit: contain вписывает их по высоте и центрует по горизонтали: y совпадает с картинкой,
// а x пересчитан из её центра.
type Point = { x: number; y: number };
type DuckAnchors = {
  head: Point;   // макушка купола — сюда садится головной убор
  headW: number; // ширина головы в % коробки — от неё считается размер убора
  body: Point;   // грудь — сюда идёт куртка
  feet: Point;   // боты
};
// feet — это ПЕРЕДНЯЯ лапа, а не середина между лапами: у стоящих поз лапы разведены, и центр
// общего пролёта попадал в пустоту между ними. Взят самый широкий «остров» непрозрачных пикселей
// в нижней строке. cream сидит, отдельных лап у него в нижней строке нет — там значение подобрано.
const ANCHORS: Record<string, DuckAnchors> = {
  cream: { head: { x: 38.3, y: 1.4 }, headW: 35.5, body: { x: 52.9, y: 54.8 }, feet: { x: 45.0, y: 92.0 } },
  graphite: { head: { x: 51.9, y: 1.2 }, headW: 28.3, body: { x: 50.0, y: 54.8 }, feet: { x: 40.0, y: 93.6 } },
  lavender: { head: { x: 36.3, y: 1.2 }, headW: 28.6, body: { x: 55.1, y: 54.8 }, feet: { x: 63.6, y: 93.6 } },
  sky: { head: { x: 61.3, y: 1.2 }, headW: 35.0, body: { x: 45.4, y: 54.8 }, feet: { x: 33.7, y: 93.6 } },
};

// У эмодзи разная внутренняя посадка в кегле: 🎩 и 👒 висят в своей строке заметно выше, чем 👑.
// Общий якорь для всех даёт «парящие» шляпы, поэтому у отдельных предметов свой сдвиг в % коробки.
const HEAD_NUDGE: Record<string, number> = { "top-hat": 4, "sun-hat": 2, helmet: 1 };

// Куда и какого размера класть аксессуар каждого слота.
// dy сдвигает якорь вверх на долю собственного размера: убор должен сидеть НА макушке, а не в ней.
function placement(slot: string, id: string, a: DuckAnchors, size: number) {
  if (slot === "head") return { x: a.head.x, y: a.head.y + 5 + (HEAD_NUDGE[id] ?? 0), px: size * (a.headW / 100) * 0.78, anchorY: "62%" };
  if (slot === "jacket") return { x: a.body.x, y: a.body.y - 1, px: size * 0.2, anchorY: "50%" };
  if (slot === "boots") return { x: a.feet.x, y: a.feet.y - 3, px: size * 0.19, anchorY: "50%" };
  // Игрушка стоит на земле рядом с уткой, со стороны, противоположной голове.
  return { x: a.head.x < 50 ? 84 : 16, y: 88, px: size * 0.22, anchorY: "60%" };
}

// Показать утку: рендер с перекраской → эмодзи (фолбэк для видов без палитры).
// `accessories` — надетое снаряжение; передаётся только там, где утку показывают крупно.
export function PetArt({
  species,
  size = 64,
  className,
  accessories,
}: {
  species: string;
  size?: number;
  className?: string;
  accessories?: string[];
}) {
  const skin = DUCKS[species];
  if (skin) {
    const anchors = ANCHORS[skin.base];
    const worn = (accessories ?? [])
      .map((id) => ACCESSORIES.find((a) => a.id === id))
      .filter((a): a is (typeof ACCESSORIES)[number] => Boolean(a));
    const img = (
      <img
        src={`/ducks/${skin.base}.webp`}
        width={size}
        height={size}
        alt={petById(species)?.label ?? species}
        // Все рендеры одной высоты (420px), поэтому object-fit: contain даёт всем видам
        // одинаковый масштаб — утки в списке не «прыгают» по размеру.
        // filter висит на картинке, а не на обёртке: аксессуары перекрашивать не надо.
        style={{ display: "block", objectFit: "contain", filter: skin.filter }}
        draggable={false}
      />
    );
    if (!worn.length) return <span className={className} style={{ display: "block" }}>{img}</span>;
    return (
      <span className={className} style={{ display: "block", position: "relative", width: size, height: size }}>
        {img}
        {worn.map((a) => {
          const p = placement(a.type, a.id, anchors, size);
          return (
            <span
              key={a.id}
              title={a.label}
              style={{
                position: "absolute",
                left: `${p.x}%`,
                top: `${p.y}%`,
                transform: `translate(-50%, -${p.anchorY})`,
                fontSize: p.px,
                lineHeight: 1,
                pointerEvents: "none",
                userSelect: "none",
                filter: "drop-shadow(0 2px 3px rgba(0,0,0,.45))",
              }}
            >
              {a.emoji}
            </span>
          );
        })}
      </span>
    );
  }
  return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{petById(species)?.emoji ?? "🦆"}</span>;
}
