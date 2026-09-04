// ===== Голос утки =====
// Порт синтезатора настоящего Microduck: github.com/pollen-robotics/microduck (Apache-2.0),
// файлы sounds/src/{personality,synth,voices}.rs. Портирована ветка `greet` — то самое
// «wak-wak», которым робот здоровается. Аудиофайлов нет: всё считается на лету, как у них.
//
// Зачем именно так: у настоящего Microduck голос выводится из seed и закрепляется за
// конкретным роботом навсегда («Each Microduck gets its own audio identity the first time it
// wakes up»). Мы делаем то же самое: seed = вид утки, поэтому у каждой модели свой узнаваемый
// голос, а `variant` даёт живую вариацию от клика к клику, не меняя тембр.
//
// Отличия от оригинала: их Rng заменён на mulberry32 (детерминированный, но другой поток
// чисел), поэтому конкретные голоса не совпадают с прошивкой робота — совпадает модель звука.

// Возгласы, которые умеет утка. В оригинале рецептов больше (alarm, inquire, chirp, coo) —
// портированы те, которым в игре нашлось место.
export type DuckCall = "greet" | "peck" | "cheer" | "honk";

// ---------- ГСЧ ----------
function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random,
    uniform: (a: number, b: number) => a + (b - a) * random(),
    choice: <T,>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)],
    integers: (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo)),
    // Box–Muller: нужен для jitter и розового шума.
    normal: () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()),
  };
}
type Rng = ReturnType<typeof makeRng>;

// ---------- Личность (personality.rs) ----------
type Personality = {
  pitchCenterHz: number;
  pitchSpread: number;
  glideBias: number;
  brightness: number;
  tilt: number;
  nasal: number;
  harmonicSkew: number;
  formantN: number;
  formantGain: number;
  vibratoRateHz: number;
  vibratoDepth: number;
  jitterDepth: number;
  breath: number;
  quackiness: number;
  amRateHz: number;
  amDepth: number;
  attackSharpness: number;
  speed: number;
};

function personality(seed: number): Personality {
  const r = makeRng(seed);
  // Популяция сидит низко (утка/жаба), но часть особей мельче и выше, часть крупнее и ниже.
  const register = r.choice([-1, 0, 0, 1]) + r.uniform(-0.4, 0.4);
  const base = r.uniform(160, 380);
  const pitch = Math.min(620, Math.max(110, base * Math.pow(2, register * 0.45)));
  return {
    pitchCenterHz: pitch,
    pitchSpread: r.uniform(0.4, 1.2),
    glideBias: r.uniform(-1, 1),
    brightness: r.uniform(0.05, 0.55),
    tilt: r.uniform(1.4, 2.8),
    nasal: r.uniform(0.1, 1.0),
    harmonicSkew: r.uniform(-1, 1),
    formantN: r.integers(1, 6),
    formantGain: r.uniform(0, 1.4),
    vibratoRateHz: r.uniform(3.5, 9.5),
    vibratoDepth: r.uniform(0, 0.7),
    jitterDepth: r.uniform(0.03, 0.35),
    breath: r.uniform(0, 0.3),
    quackiness: r.uniform(0.2, 1.0),
    amRateHz: r.uniform(18, 55),
    amDepth: r.uniform(0.15, 0.7),
    attackSharpness: r.uniform(0, 1),
    speed: r.uniform(0.82, 1.22),
  };
}

// Веса гармоник: наклон спектра + подъём верха + «нос» на 2-3-й + чёт/нечет перекос + форманта.
const N_HARM = 7;
function harmonics(p: Personality): number[] {
  const w: number[] = [];
  for (let n = 1; n <= N_HARM; n++) {
    const base = 1 / Math.pow(n, p.tilt);
    const highLift = p.brightness * Math.pow(n / N_HARM, 1.5);
    const nasal = n === 2 || n === 3 ? p.nasal * 0.6 : 0;
    const skew =
      p.harmonicSkew >= 0
        ? p.harmonicSkew * (n % 2 === 0 ? 0.4 : -0.2)
        : -p.harmonicSkew * (n % 2 === 0 ? -0.3 : 0.4);
    const formant = n === p.formantN ? p.formantGain : 0;
    w.push(Math.max(0, base + highLift + nasal + skew + formant * base * 1.5));
  }
  w[0] = Math.max(w[0], 0.7); // f0 всегда слышен, иначе теряется высота тона
  return w;
}

// ---------- Примитивы DSP (synth.rs) ----------
const TUNED_SR = 22050; // рецепты крутились на этой частоте; две константы ниже под неё подогнаны

// Кусочно-линейная кривая через точки (время, значение), с зажимом по краям.
function lerpCurve(n: number, sr: number, points: [number, number][]): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / sr;
    if (x <= points[0][0]) { out[i] = points[0][1]; continue; }
    let v = points[points.length - 1][1];
    for (let k = 0; k < points.length - 1; k++) {
      const [x0, y0] = points[k];
      const [x1, y1] = points[k + 1];
      if (x <= x1) { v = x1 <= x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); break; }
    }
    out[i] = v;
  }
  return out;
}

// Быстрая атака, экспоненциальный спад, пик ~1.0.
function expDecay(n: number, sr: number, attackS: number, decayS: number): Float32Array {
  const a = Math.max(1e-4, attackS);
  const d = Math.max(1e-4, decayS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / sr;
    out[i] = Math.min(1, x / a) * Math.exp(-Math.max(0, x - a) / d);
  }
  return out;
}

// Множитель высоты от медленного LFO (в полутонах).
function vibrato(n: number, sr: number, rateHz: number, depthSemi: number, phase: number): Float32Array {
  const out = new Float32Array(n);
  if (rateHz <= 0 || depthSemi <= 0) return out.fill(1);
  for (let i = 0; i < n; i++) {
    const lfo = Math.sin(2 * Math.PI * rateHz * (i / sr) + phase);
    out[i] = Math.pow(2, (depthSemi * lfo) / 12);
  }
  return out;
}

// Микродрожь высоты: сглаженный белый шум → множитель в полутонах.
function jitter(n: number, sr: number, depthSemi: number, r: Rng): Float32Array {
  const out = new Float32Array(n);
  if (depthSemi <= 0) return out.fill(1);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = r.normal();
  const k = Math.max(1, Math.round((64 * sr) / TUNED_SR)); // окно держит ВРЕМЯ, а не число сэмплов
  const offset = (k - 1) >> 1;
  let acc = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < n; i++) {
    const wantHi = Math.min(n, i + offset + 1);
    const wantLo = Math.max(0, i - k + 1 + offset);
    while (hi < wantHi) acc += raw[hi++];
    while (lo < wantLo) acc -= raw[lo++];
    out[i] = Math.pow(2, ((acc / k) * depthSemi) / 12);
  }
  return out;
}

// Розовый шум для «дыхания» в голосе.
function pinkNoise(n: number, r: Rng, sr: number): Float32Array {
  const a = Math.pow(0.985, TUNED_SR / sr);
  const out = new Float32Array(n);
  let leak = 0;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    leak = a * leak + r.normal();
    out[i] = leak;
    if (Math.abs(leak) > peak) peak = Math.abs(leak);
  }
  for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

function normalise(x: Float32Array, peakDbfs: number) {
  let peak = 1e-9;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak) peak = Math.abs(x[i]);
  const gain = Math.pow(10, peakDbfs / 20) / peak;
  for (let i = 0; i < x.length; i++) x[i] *= gain;
}

// ---------- Голос (voices.rs) ----------
// Время атаки, приправленное attack_sharpness. snappy=1 у резких рецептов.
function attackTime(p: Personality, dur: number, snappy: number): number {
  const soft = 0.04 * dur;
  const sharp = 0.003 * dur;
  return Math.max(0.001, soft + (sharp - soft) * p.attackSharpness * snappy);
}

// Общее ядро: гармонический осциллятор + вибрато + джиттер + AM-жужжание + дыхание.
function voice(p: Personality, freq: Float32Array, sr: number, r: Rng, amScale: number, breathScale: number): Float32Array {
  const n = freq.length;
  const vib = vibrato(n, sr, p.vibratoRateHz, p.vibratoDepth, r.uniform(0, 2 * Math.PI));
  const jit = jitter(n, sr, p.jitterDepth, r);
  const w = harmonics(p);
  const body = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * (freq[i] * vib[i] * jit[i])) / sr;
    let v = 0;
    for (let h = 0; h < N_HARM; h++) if (w[h] !== 0) v += w[h] * Math.sin((h + 1) * phase);
    body[i] = v;
  }
  // «Квакучесть» открывает AM-жужжание: чистотонные утки почти не жужжат.
  const amD = p.amDepth * amScale * p.quackiness;
  if (amD > 0.01) {
    for (let i = 0; i < n; i++) {
      body[i] *= 1 - amD * (0.5 + 0.5 * Math.sin(2 * Math.PI * p.amRateHz * (i / sr)));
    }
  }
  const breath = p.breath * breathScale;
  if (breath > 0) {
    const noise = pinkNoise(n, r, sr);
    for (let i = 0; i < n; i++) body[i] += breath * noise[i];
  }
  return body;
}

// Один слог «wak».
function greetSyllable(p: Personality, r: Rng, sr: number, durScale: number, f0Scale: number): Float32Array {
  const dur = ((0.32 + 0.25 * r.random()) * durScale) / p.speed;
  const n = Math.max(1, Math.round(dur * sr));
  const f0 = p.pitchCenterHz * (0.9 + 0.15 * r.random()) * f0Scale;
  // glide_bias переворачивает контур: положительные утки загибают вверх, отрицательные вниз.
  const bend = 0.1 + 0.15 * p.pitchSpread;
  const start = f0 * (1 - p.glideBias * bend * 0.5);
  const mid = f0 * (1 + p.glideBias * bend);
  const end = f0 * (1 - p.glideBias * bend * 0.3) * (0.92 + 0.08 * r.random());
  const freq = lerpCurve(n, sr, [[0, start], [0.18 * dur, mid], [dur, end]]);
  const env = expDecay(n, sr, attackTime(p, dur, 0.5), dur * 0.7);
  const sig = voice(p, freq, sr, r, 1.0, 1.0);
  for (let i = 0; i < n; i++) sig[i] *= env[i];
  return sig;
}

// Приветствие: один слог, а иногда двойной «wak-wak» — так утка звучит гораздо живее.
function greet(p: Personality, r: Rng, sr: number): Float32Array {
  const first = greetSyllable(p, r, sr, 1.0, 1.0);
  let out = first;
  if (r.random() < 0.4) {
    const gapN = Math.round(((0.05 + 0.06 * r.random()) / p.speed) * sr);
    const second = greetSyllable(p, r, sr, 0.8, 0.95 + 0.06 * r.random());
    out = new Float32Array(first.length + gapN + second.length);
    out.set(first, 0);
    out.set(second, first.length + gapN);
  }
  normalise(out, -3);
  return out;
}

// Клевок: короткий низкий «ток» с щелчком в атаке. Утка так реагирует на еду.
function peck(p: Personality, r: Rng, sr: number): Float32Array {
  const dur = (0.16 + 0.12 * r.random()) / p.speed;
  const n = Math.max(1, Math.round(dur * sr));
  // Всегда ниже обычного голоса этой утки: крупные (низкий регистр) клюют совсем басом.
  const f0 = p.pitchCenterHz * (0.45 + 0.2 * r.random());
  const freq = lerpCurve(n, sr, [[0, f0 * 1.5], [0.04 * dur, f0], [dur, f0 * 0.8]]);
  const env = expDecay(n, sr, attackTime(p, dur, 1.0), dur * 0.35);
  const sig = voice(p, freq, sr, r, 0.3, 0.5);
  for (let i = 0; i < n; i++) sig[i] *= env[i];
  // Резкость щелчка зависит от attack_sharpness: «снайперские» утки цокают звонче.
  const clickLen = Math.min(n, Math.round((0.003 + 0.006 * p.attackSharpness) * sr));
  const clickGain = 0.4 + 0.4 * p.attackSharpness;
  for (let i = 0; i < clickLen; i++) {
    const fade = 1 - i / clickLen;
    sig[i] += clickGain * r.uniform(-1, 1) * fade * fade;
  }
  normalise(sig, -3);
  return sig;
}

// Торжествующий гудок на победу в бою. Короткий, взятый выше обычного голоса этой утки:
// нарочно НЕ `cheer`, потому что победа часто тут же даёт уровень, а левелап квакает `cheer` —
// два одинаковых глиссандо легли бы друг на друга.
function honk(p: Personality, r: Rng, sr: number): Float32Array {
  const dur = (0.2 + 0.12 * r.random()) / p.speed;
  const n = Math.max(1, Math.round(dur * sr));
  // Выше центра, но в пределах гудка; pitchSpread решает, насколько высоко забирается.
  const f0 = p.pitchCenterHz * (1.25 + 0.35 * p.pitchSpread) * (0.94 + 0.12 * r.random());
  const peakMul = 1.15 + 0.25 * p.pitchSpread + 0.1 * r.random();
  const fallMul = 0.75 + 0.2 * (1 - p.pitchSpread);
  const freq = lerpCurve(n, sr, [[0, f0], [0.05 * dur, f0 * peakMul], [dur, f0 * fallMul]]);
  const env = expDecay(n, sr, attackTime(p, dur, 1.0), dur * (0.4 + 0.2 * r.random()));
  const sig = voice(p, freq, sr, r, 0.5, 1.0);
  for (let i = 0; i < n; i++) sig[i] *= env[i];
  // Хрип на пике зависит от brightness: яркие утки скрипят, мягкие просто вскрикивают.
  const crackle = 0.04 + 0.1 * p.brightness;
  for (let i = 0; i < n; i++) sig[i] += crackle * r.normal() * env[i];
  normalise(sig, -3);
  return sig;
}

// Радостный возглас на левелап.
// Оригинальный `wheee` — длинная «поездка» с зацикленной серединой: робот тянет её, пока зажат
// курок. Нам нужен возглас, а не поездка, поэтому ускоряем в 1.9 раза и выбрасываем петлю,
// оставляя разгон и финал. Стык ровный: на петле высота держится постоянной (f0*top с обеих сторон).
function cheer(p: Personality, r: Rng, sr: number): Float32Array {
  const speed = p.speed * 1.9;
  const dStart = (0.8 + 0.3 * r.random()) / speed;
  const dLoop = (1.6 + 0.6 * r.random()) / speed;
  const dEnd = (0.55 + 0.25 * r.random()) / speed;
  const total = dStart + dLoop + dEnd;
  const n = Math.max(1, Math.round(total * sr));
  const t1 = dStart;
  const t2 = dStart + dLoop;
  const f0 = p.pitchCenterHz * (0.95 + 0.1 * r.random());
  // Насколько высоко забирается: «разбросанные» утки визжат выше.
  const top = 1.6 + 0.5 * p.pitchSpread + 0.25 * r.random();
  const base = lerpCurve(n, sr, [
    [0, f0 * 0.85], [0.15 * dStart, f0], [t1, f0 * top],
    [t2, f0 * top], [t2 + 0.25 * dEnd, f0 * top * 1.04], [total, f0 * 0.6],
  ]);
  // Дрожь восторга, набирающая силу к разгону.
  const wobHz = 4.5 + 3 * r.random();
  const swell = lerpCurve(n, sr, [[0, 0.15], [t1, 1], [total, 1]]);
  const freq = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wob = Math.sin(2 * Math.PI * wobHz * (i / sr));
    freq[i] = base[i] * Math.pow(2, (0.5 * swell[i] * wob) / 12);
  }
  const env = lerpCurve(n, sr, [[0, 0], [Math.min(0.06, 0.5 * dStart), 1], [t2 + 0.4 * dEnd, 1], [total, 0]]);
  // Дрожь заменяет вибрато, жужжания меньше — чтобы глиссандо осталось чистым.
  const pJoy: Personality = { ...p, vibratoDepth: p.vibratoDepth * 0.5, quackiness: p.quackiness * 0.5 };
  const sig = voice(pJoy, freq, sr, r, 0.5, 0.5);
  for (let i = 0; i < n; i++) sig[i] *= env[i];
  normalise(sig, -4); // нормируем ДО нарезки, иначе куски разъедутся по громкости
  const n1 = Math.round(t1 * sr);
  const n2 = Math.min(n, Math.round(t2 * sr));
  const out = new Float32Array(n1 + (n - n2));
  out.set(sig.subarray(0, n1), 0);
  out.set(sig.subarray(n2), n1);
  return out;
}

// ---------- Проигрывание ----------
// Один общий AudioContext на всю игру: браузеры ограничивают их число, а квакаем мы часто.
let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null; // аудио недоступно — молча живём дальше
  }
}

// Строка вида → стабильное 32-битное зерно, чтобы у вида всегда был один и тот же голос.
function seedOf(species: string): number {
  let h = 2166136261;
  for (let i = 0; i < species.length; i++) {
    h ^= species.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Синтезировать «wak» конкретного вида в моно-семплы. Вынесено из playQwak, чтобы звук можно
// было отрендерить вне браузера (скрипт превью пишет из этого WAV-ы на прослушку).
// variant — как в оригинале: та же утка, но чуть другой возглас; тембр от вида не зависит.
export function renderQwak(species: string, sampleRate: number, variant = 0, call: DuckCall = "greet"): Float32Array {
  const seed = seedOf(species);
  const p = personality(seed);
  const r = makeRng((seed ^ Math.imul(variant, 2654435761)) >>> 0);
  if (call === "peck") return peck(p, r, sampleRate);
  if (call === "honk") return honk(p, r, sampleRate);
  if (call === "cheer") return cheer(p, r, sampleRate);
  return greet(p, r, sampleRate);
}

// Квакнуть голосом конкретного вида. Тембр закреплён за видом, вариация — за клик.
// Громкость на каждый возглас. Рецепты нормированы по ПИКУ, а слышимая громкость идёт за
// средней энергией: `cheer` тянет почти секунду и звучит заметно громче короткого щелчка
// `peck` при том же пике. Поэтому у длинного возгласа множитель ниже, у транзиента выше —
// иначе левелап бьёт по ушам, а кормёжку не слышно.
const CALL_GAIN: Record<DuckCall, number> = { greet: 0.22, peck: 0.26, cheer: 0.15, honk: 0.2 };

export function playQwak(species: string, call: DuckCall = "greet", volume = CALL_GAIN[call]) {
  try {
    const ac = audioCtx();
    if (!ac) return;
    const sr = ac.sampleRate;
    const sig = renderQwak(species, sr, Math.floor(Math.random() * 0xffff), call);
    const buf = ac.createBuffer(1, sig.length, sr);
    buf.getChannelData(0).set(sig); // не copyToChannel: у него типы Float32Array<ArrayBuffer> строже
    const src = ac.createBufferSource();
    const g = ac.createGain();
    g.gain.value = volume;
    src.buffer = buf;
    src.connect(g).connect(ac.destination);
    src.start();
  } catch {
    /* аудио недоступно — игнорируем */
  }
}
