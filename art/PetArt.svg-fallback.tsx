import { type ReactNode } from "react";
import { petById } from "../game/pets";

// ===== Робо-утки Duckverse (оригинальный арт) =====
// Все виды — одна и та же конструкция утки-робота: купол-голова, плоский клюв,
// один большой объектив вместо глаза, шасси-корпус и толстые боты. Отличаются
// палитрой и «апгрейдом» (антенна, наушники, корона...) — чем реже вид, тем наряднее.
// Общая система координат: viewBox 0 0 100 100, голова x26..78 (купол y12..54),
// объектив в (60,32), клюв слева x25..52 (y39..54), боты внизу y85..96.

type DuckSkin = {
  shell: string;      // купол головы и нагрудник
  shellDark: string;  // тень купола / нижняя кромка
  bill: string;       // клюв и боты
  billDark: string;   // тень клюва / подошва
  lens: string;       // кольцо объектива
  glass?: string;     // стекло объектива (по умолчанию тёмное)
  chassis?: string;   // корпус
  behind?: ReactNode; // слой ПОД уткой (ореол, кольцо)
  front?: ReactNode;  // слой ПОВЕРХ утки (антенна, наушники, корона)
};

const CHASSIS = "#33383f";
const CHASSIS_DARK = "#22262c";
const GLASS = "#14171c";

// Собрать утку из палитры. Слои снизу вверх: behind → боты/ноги → корпус → шея → купол → клюв → объектив → front.
function Duck({ s }: { s: DuckSkin }) {
  const chassis = s.chassis ?? CHASSIS;
  const glass = s.glass ?? GLASS;
  return (
    <>
      {s.behind}

      {/* боты */}
      <rect x="26" y="85" width="22" height="11" rx="5.5" fill={s.bill} />
      <rect x="52" y="85" width="22" height="11" rx="5.5" fill={s.bill} />
      <rect x="26" y="92" width="22" height="4" rx="2" fill={s.billDark} />
      <rect x="52" y="92" width="22" height="4" rx="2" fill={s.billDark} />

      {/* ноги */}
      <rect x="34" y="79" width="9" height="9" rx="4" fill={CHASSIS_DARK} />
      <rect x="57" y="79" width="9" height="9" rx="4" fill={CHASSIS_DARK} />

      {/* корпус */}
      <rect x="30" y="59" width="40" height="25" rx="11" fill={chassis} />
      <rect x="38" y="63" width="24" height="16" rx="7" fill={s.shell} />
      <path d="M44 68 h12 M44 72 h12" stroke={s.shellDark} strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <circle cx="30" cy="66" r="6.5" fill={s.shellDark} />
      <circle cx="70" cy="66" r="6.5" fill={s.shellDark} />

      {/* шея-гофра */}
      <rect x="43" y="50" width="16" height="12" rx="4" fill={CHASSIS_DARK} />
      <path d="M44 54 h14 M44 57.5 h14" stroke="#4a505a" strokeWidth="1.4" strokeLinecap="round" />

      {/* купол-голова */}
      <path d="M26 34 a26 22 0 0 1 52 0 v12 a8 8 0 0 1 -8 8 H34 a8 8 0 0 1 -8 -8 Z" fill={s.shell} />
      <path d="M26 45 h52 v1 a8 8 0 0 1 -8 8 H34 a8 8 0 0 1 -8 -8 Z" fill={s.shellDark} />
      <ellipse cx="42" cy="21" rx="12" ry="6.5" fill="#fff" opacity=".22" transform="rotate(-20 42 21)" />

      {/* клюв */}
      <path d="M52 39 H25 a7.5 7.5 0 0 0 0 15 H52 Z" fill={s.bill} />
      <path d="M25 46.5 H52" stroke={s.billDark} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="32" cy="43.5" r="1.3" fill={s.billDark} />

      {/* объектив-глаз */}
      <circle cx="60" cy="32" r="12" fill={s.lens} />
      <circle cx="60" cy="32" r="9.5" fill="#1b1e24" />
      <circle cx="60" cy="32" r="7" fill={glass} />
      <circle cx="63" cy="28.5" r="2.7" fill="#fff" opacity=".92" />
      <circle cx="56.4" cy="36" r="1.3" fill="#fff" opacity=".5" />

      {s.front}
    </>
  );
}

// Антенна — общий апгрейд, чтобы не копипастить.
const antenna = (color: string) => (
  <>
    <path d="M62 13 V4" stroke={CHASSIS_DARK} strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="62" cy="3" r="3.2" fill={color} />
  </>
);

// Палитра на каждый вид. ID видов НЕ меняли — сейвы, сервер и маркетплейс совместимы.
const DUCKS: Record<string, DuckSkin> = {
  // --- common: стартовые ---
  // Scout Duck — классическая белая микроутка
  dog: { shell: "#f2f4f7", shellDark: "#cdd3dc", bill: "#ff8a2b", billDark: "#d9661a", lens: "#ffb648" },
  // Carbon Duck — угольный корпус, кислотно-зелёный объектив
  cat: { shell: "#3c414a", shellDark: "#2a2e35", bill: "#ff8a2b", billDark: "#d9661a", lens: "#9ade4a", glass: "#101a10" },
  // Sunny Duck — жёлтый ретро-робот с антенной
  hamster: {
    shell: "#ffd23f", shellDark: "#d9a51f", bill: "#ff8a2b", billDark: "#d9661a", lens: "#ffe9a8",
    front: antenna("#ff8a2b"),
  },

  // --- rare ---
  // Beat Duck — мятная утка в наушниках
  rabbit: {
    shell: "#8ee6cf", shellDark: "#5cbfa6", bill: "#ff8a2b", billDark: "#d9661a", lens: "#38d3ff",
    front: (
      <>
        <path d="M22 33 a30 27 0 0 1 60 0" stroke="#2f333b" strokeWidth="5" fill="none" strokeLinecap="round" />
        <rect x="15" y="24" width="13" height="18" rx="6" fill="#2f333b" />
        <rect x="76" y="24" width="13" height="18" rx="6" fill="#2f333b" />
        <rect x="18" y="28" width="7" height="11" rx="3.5" fill="#38d3ff" opacity=".85" />
        <rect x="79" y="28" width="7" height="11" rx="3.5" fill="#38d3ff" opacity=".85" />
      </>
    ),
  },
  // Leaf Duck — зелёная утка с ростком
  frog: {
    shell: "#7ec850", shellDark: "#579a34", bill: "#ffb62b", billDark: "#d98d1a", lens: "#d6f58a",
    front: (
      <>
        <path d="M52 13 q1 -8 6 -11" stroke="#3f8f3a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <ellipse cx="61" cy="3" rx="6" ry="3.4" fill="#68c94e" transform="rotate(-25 61 3)" />
        <ellipse cx="50" cy="6" rx="5" ry="2.8" fill="#8ade6a" transform="rotate(20 50 6)" />
      </>
    ),
  },
  // Frost Duck — ледяная утка в шарфе
  penguin: {
    shell: "#dff1ff", shellDark: "#a9cde6", bill: "#ff8a2b", billDark: "#d9661a", lens: "#5fd0ff", glass: "#0c1b26",
    front: (
      <>
        <path d="M38 53 h24 v5 a5 5 0 0 1 -5 5 H43 a5 5 0 0 1 -5 -5 Z" fill="#57bff0" />
        <path d="M60 60 l7 12 l-6 1 l-4 -11 z" fill="#3fa8dc" />
        <path d="M22 16 v9 M17.5 20.5 h9 M18.8 17.3 l6.4 6.4 M25.2 17.3 l-6.4 6.4" stroke="#bfe9ff" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },

  // --- epic ---
  // Ember Duck — раскалённая утка с языком пламени
  fox: {
    shell: "#f07a35", shellDark: "#c2531b", bill: "#ffd23f", billDark: "#d9a51f", lens: "#ffdf6b", glass: "#2a1104",
    front: (
      <>
        <path d="M50 13 q-7 -9 1 -13 q-1 6 6 8 q5 2 2 7 z" fill="#ffb038" />
        <path d="M52 12 q-3 -5 1 -8 q0 4 3 5 z" fill="#fff0a8" />
      </>
    ),
  },
  // Tuxedo Duck — чёрно-белая «фрачная» утка с бабочкой
  panda: {
    shell: "#f4f6f9", shellDark: "#1f2229", bill: "#ff8a2b", billDark: "#d9661a", lens: "#2b2f38", glass: "#0a0c10",
    chassis: "#1f2229",
    front: (
      <>
        <path d="M43 55 l8 4.5 l-8 4.5 z M59 55 l-8 4.5 l8 4.5 z" fill="#e0454a" />
        <circle cx="51" cy="59.5" r="2.1" fill="#f0797c" />
      </>
    ),
  },
  // Night Duck — ночная утка с «ушками»-антеннами и звёздами
  owl: {
    shell: "#4b3f8f", shellDark: "#31285f", bill: "#ffb62b", billDark: "#d98d1a", lens: "#b58cff", glass: "#110c22",
    front: (
      <>
        <path d="M33 17 l-4 -12 l11 6 z" fill="#31285f" />
        <path d="M71 15 l6 -11 l3 12 z" fill="#31285f" />
        <path d="M16 24 l1.4 3.4 l3.6 1.2 l-3.6 1.2 l-1.4 3.4 l-1.4 -3.4 l-3.6 -1.2 l3.6 -1.2 z" fill="#d9c8ff" opacity=".85" />
        <path d="M85 24 l1.1 2.7 l2.9 1 l-2.9 1 l-1.1 2.7 l-1.1 -2.7 l-2.9 -1 l2.9 -1 z" fill="#d9c8ff" opacity=".7" />
      </>
    ),
  },

  // --- legendary ---
  // Chrome Duck — полированный хром с гребнем
  lion: {
    shell: "#dfe6ef", shellDark: "#98a5b6", bill: "#ff8a2b", billDark: "#d9661a", lens: "#eaf2ff", glass: "#0f1319",
    front: (
      <>
        <path d="M44 12 q8 -13 16 -3 q-8 -1 -16 3 z" fill="#c7d3e2" />
        <path d="M30 30 q10 -14 26 -16" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".55" />
      </>
    ),
  },
  // Volt Duck — электрическая утка с молнией
  tiger: {
    shell: "#ffc21f", shellDark: "#1f2229", bill: "#ff8a2b", billDark: "#d9661a", lens: "#fff27a", glass: "#1a1400",
    front: (
      <>
        <path d="M30 25 q6 -4 11 -1 M31 33 q6 -4 11 -1" stroke="#1f2229" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".45" />
        <path d="M58 13 l-3 -10 l9 4 l-3 -8" stroke="#fff27a" strokeWidth="2.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </>
    ),
  },
  // Prism Duck — переливчатая утка с рогом
  unicorn: {
    shell: "#ffd7f2", shellDark: "#d79ccd", bill: "#ffb62b", billDark: "#d98d1a", lens: "#8be6ff", glass: "#1a1030",
    front: (
      <>
        <path d="M49 13 l5 -16 l7 14 z" fill="#ffe9a8" stroke="#e6b84a" strokeWidth="1" />
        <path d="M51 7 l6 1 M52.5 2 l5 1" stroke="#e6b84a" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M30 32 q4 -12 14 -16" stroke="#a8e6ff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".8" />
        <path d="M35 36 q4 -12 14 -16" stroke="#ffb3e6" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".7" />
      </>
    ),
  },

  // --- mythic ---
  // Golden Duck — золотая утка в короне (перк «Golden Hoard»)
  dragon: {
    shell: "#ffcf3d", shellDark: "#c9962a", bill: "#ff7a1a", billDark: "#c25510", lens: "#fff0b0", glass: "#2a1a00",
    chassis: "#4a3a12",
    behind: <circle cx="50" cy="52" r="46" fill="#ffcf3d" opacity=".14" />,
    front: (
      <>
        <path d="M33 18 l3 -12 l7 7 l6 -11 l6 11 l7 -7 l3 12 z" fill="#ffe27a" stroke="#c9962a" strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="36" cy="5" r="2" fill="#fff6cf" />
        <circle cx="52" cy="1.6" r="2.2" fill="#fff6cf" />
        <circle cx="68" cy="5" r="2" fill="#fff6cf" />
      </>
    ),
  },
  // Eternal Duck — обсидиан с вечным ядром (перк «Eternal»)
  dino: {
    shell: "#232833", shellDark: "#151920", bill: "#3ff0d2", billDark: "#22a894", lens: "#3ff0d2", glass: "#04201c",
    chassis: "#181c24",
    behind: (
      <>
        <circle cx="50" cy="52" r="46" fill="#3ff0d2" opacity=".12" />
        <ellipse cx="52" cy="9" rx="19" ry="5.5" fill="none" stroke="#3ff0d2" strokeWidth="2.6" opacity=".9" />
      </>
    ),
    front: (
      <>
        <circle cx="50" cy="71" r="4.2" fill="#3ff0d2" />
        <circle cx="50" cy="71" r="7" fill="none" stroke="#3ff0d2" strokeWidth="1.2" opacity=".55" />
      </>
    ),
  },
};

// Показать утку: свой SVG → эмодзи (фолбэк для видов без палитры).
export function PetArt({ species, size = 64, className }: { species: string; size?: number; className?: string }) {
  const skin = DUCKS[species];
  if (skin) {
    return (
      <svg className={className} viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden style={{ display: "block" }}>
        <Duck s={skin} />
      </svg>
    );
  }
  return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{petById(species)?.emoji ?? "🦆"}</span>;
}
