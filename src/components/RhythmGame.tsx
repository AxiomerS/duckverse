import { useEffect, useRef, useState } from "react";
import { startMusic } from "../game/music";
import { PetArt } from "./PetArt";

// Простая ритм-игра в духе osu!mania: ноты падают по 4 дорожкам,
// жми клавишу (или кликни дорожку), когда нота на линии попадания.

const LANES = 4;
// Физические коды клавиш (не зависят от раскладки — работают и на русской).
const CODES = ["KeyG", "KeyH", "KeyJ", "KeyK"];
const KEY_LABEL = ["G", "H", "J", "K"];
const LANE_COLORS = ["#ff7ac8", "#7aa2ff", "#ffd23f", "#1ad17a"];

const LANE_W = 70;
const FIELD_H = 360;
const HIT_Y = 320; // y линии попадания внутри поля
const NOTE_H = 20;
const BASE_APPROACH = 1700; // базовое время полёта ноты (делится на скорость)
const BASE_INTERVAL = 560; // базовый интервал между нотами (делится на скорость)
const MAX_SPEED = 2.5; // к концу песни игра и музыка ускоряются до 2.5x

const PERFECT_MS = 55;
const GOOD_MS = 120;
const MISS_MS = 160; // позже этого — нота считается пропущенной
const MAX_MISS = 5; // столько промахов = поражение

// Хэштег для шеринга в X/Twitter. TODO: заменить на финальный, когда выберешь.
const SHARE_HASHTAG = "Duckverse";

// Множитель очков за комбо: ×1.1 со 100, ×1.2 с 200, ×1.3 с 300 (потолок 1.3).
function comboMult(combo: number): number {
  return 1 + 0.1 * Math.min(3, Math.floor(combo / 100));
}

type Judge = "perfect" | "good" | "miss";
type Note = { id: number; lane: number; t: number; approach: number; hit: null | Judge };

// Сколько нот падает ОДНОВРЕМЕННО (аккорд) в этот момент трека — усложнение по ходу игры:
// первые 15% — только одиночные ноты, дальше подмешиваются двойные, с ~55% — тройные,
// а после 80% изредка (10%) встречаются четверные (все 4 дорожки разом).
function pickArity(progress: number): number {
  const r = Math.random();
  if (progress > 0.8) {
    if (r < 0.1) return 4;
    if (r < 0.35) return 3;
    if (r < 0.6) return 2;
    return 1;
  }
  if (progress > 0.55) {
    if (r < 0.15) return 3;
    if (r < 0.4) return 2;
    return 1;
  }
  if (progress > 0.15) {
    if (r < 0.22) return 2;
    return 1;
  }
  return 1;
}

// Сгенерировать чарт. Скорость плавно растёт от 1.0 до MAX_SPEED: интервалы между
// нотами и время их полёта делятся на текущую скорость → к концу всё быстрее.
function buildChart(): Note[] {
  const notes: Note[] = [];
  let id = 0;
  let t = 2000; // первая нота через 2с (плавный заход)
  const N = 300; // трек в 2 раза длиннее прежнего (было 150)
  for (let i = 0; i < N; i++) {
    const speed = 1 + (MAX_SPEED - 1) * (i / (N - 1));
    const approach = BASE_APPROACH / speed;
    const arity = pickArity(i / N);
    const lanes = new Set<number>();
    lanes.add(Math.floor(Math.random() * LANES));
    while (lanes.size < arity) lanes.add(Math.floor(Math.random() * LANES));
    for (const lane of lanes) notes.push({ id: id++, lane, t, approach, hit: null });
    t += BASE_INTERVAL / speed;
  }
  return notes;
}

type Stats = { score: number; combo: number; maxCombo: number; perfect: number; good: number; miss: number };
const freshStats = (): Stats => ({ score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0 });

export function RhythmGame({ onClose, onFinish, petName, petEmoji, petSpecies }: { onClose: () => void; onFinish: (score: number, happiness: number, durationMs: number) => void; petName: string; petEmoji: string; petSpecies: string }) {
  const [runId, setRunId] = useState(0);
  const [, setFrame] = useState(0);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const notesRef = useRef<Note[]>([]);
  const statsRef = useRef<Stats>(freshStats());
  const clockRef = useRef(0);
  const judgeRef = useRef<{ kind: Judge; at: number } | null>(null);
  const flashRef = useRef<number[]>([0, 0, 0, 0]);
  const comboTierRef = useRef(0); // текущий тир множителя комбо (0..3) — растёт со 100/200/300
  const tierPopRef = useRef(-1000); // момент последнего повышения тира — для анимации всплеска
  const heldRef = useRef<boolean[]>([false, false, false, false]);
  const rewardedRef = useRef(false);
  const doneRef = useRef(false); // после конца игнорируем нажатия
  const speedRef = useRef(1); // текущая скорость (для музыки)
  const reactRef = useRef(0); // время последнего попадания — для подпрыгивания питомца
  const acRef = useRef<AudioContext | null>(null);

  // Короткий синтезированный звук попадания.
  function playHit(kind: Judge) {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!acRef.current) acRef.current = new Ctx();
      const ctx = acRef.current;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = kind === "perfect" ? 900 : 620;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.005); // та же громкость, что и музыка
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.14);
    } catch {
      /* аудио недоступно — игнор */
    }
  }

  // Обработать нажатие по дорожке: найти ближайшую неотбитую ноту в окне.
  function hitLane(lane: number) {
    if (doneRef.current) return; // игра окончена — ввод игнорируем
    const now = clockRef.current;
    flashRef.current[lane] = now;
    let best: Note | null = null;
    let bestDt = Infinity;
    for (const n of notesRef.current) {
      if (n.lane !== lane || n.hit !== null) continue;
      const dt = Math.abs(n.t - now);
      if (dt < bestDt) { bestDt = dt; best = n; }
    }
    const s = statsRef.current;
    if (!best || bestDt > GOOD_MS) {
      // нажатие мимо ритма (нет ноты рядом) — промах и сброс комбо (анти-спам).
      s.combo = 0;
      s.miss++;
      comboTierRef.current = 0;
      judgeRef.current = { kind: "miss", at: now };
      return;
    }
    if (bestDt <= PERFECT_MS) { best.hit = "perfect"; s.perfect++; }
    else { best.hit = "good"; s.good++; }
    s.combo++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    // Очки: perfect 200 / good 100, умноженные на множитель комбо.
    const base = best.hit === "perfect" ? 200 : 100;
    s.score += Math.round(base * comboMult(s.combo));
    const tier = Math.min(3, Math.floor(s.combo / 100));
    if (tier > comboTierRef.current) { comboTierRef.current = tier; tierPopRef.current = now; }
    judgeRef.current = { kind: best.hit, at: now };
    reactRef.current = now; // питомец подпрыгивает в такт попаданию
    playHit(best.hit);
  }

  // Игровой цикл: падение нот, отлов промахов, завершение.
  useEffect(() => {
    notesRef.current = buildChart();
    statsRef.current = freshStats();
    judgeRef.current = null;
    comboTierRef.current = 0;
    tierPopRef.current = -1000;
    rewardedRef.current = false;
    doneRef.current = false;
    clockRef.current = 0;
    setDone(false);
    setFailed(false);
    speedRef.current = 1;
    const lastNoteTime = notesRef.current[notesRef.current.length - 1].t;
    const endTime = lastNoteTime + 900;
    const start = performance.now();

    // Музыка читает текущую скорость и ускоряется вместе с игрой.
    let musicStopped = false;
    const stopMusic = startMusic(() => speedRef.current);
    const stopMusicOnce = () => { if (!musicStopped) { musicStopped = true; stopMusic(); } };

    let raf = 0;
    const loop = (ts: number) => {
      const now = ts - start;
      clockRef.current = now;
      speedRef.current = 1 + (MAX_SPEED - 1) * Math.min(1, now / lastNoteTime);
      for (const n of notesRef.current) {
        if (n.hit === null && now > n.t + MISS_MS) {
          n.hit = "miss";
          statsRef.current.combo = 0;
          statsRef.current.miss++;
          comboTierRef.current = 0;
          judgeRef.current = { kind: "miss", at: now };
        }
      }
      setFrame((f) => f + 1);
      const isFailed = statsRef.current.miss >= MAX_MISS;
      if (isFailed || now > endTime) {
        doneRef.current = true;
        if (!rewardedRef.current) {
          rewardedRef.current = true;
          // Очки копятся за каждую игру (включая поражение). Sil тут не даётся — только за лидерборд.
          const s = statsRef.current;
          const total = s.perfect + s.good + s.miss;
          const acc = total ? (s.perfect + s.good * 0.5) / total : 0;
          const happiness = Math.min(40, 10 + Math.round(acc * 25));
          onFinish(s.score, happiness, now);
        }
        stopMusicOnce();
        setFailed(isFailed);
        setDone(true);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); stopMusicOnce(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Клавиатура.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const lane = CODES.indexOf(e.code);
      if (lane < 0) return;
      e.preventDefault();
      if (heldRef.current[lane]) return;
      heldRef.current[lane] = true;
      hitLane(lane);
    };
    const up = (e: KeyboardEvent) => {
      const lane = CODES.indexOf(e.code);
      if (lane >= 0) heldRef.current[lane] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { acRef.current?.close(); }, []);

  // Нарисовать красивую карточку результата на canvas (квадрат 1080×1080).
  function drawCard(): HTMLCanvasElement {
    const st = statsRef.current;
    const tot = st.perfect + st.good + st.miss;
    const accPct = tot ? Math.round(((st.perfect + st.good * 0.5) / tot) * 100) : 100;
    const isFailed = st.miss >= MAX_MISS;
    const W = 1080;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = W;
    const ctx = c.getContext("2d")!;
    const bg = ctx.createLinearGradient(0, 0, W, W);
    bg.addColorStop(0, "#15131f");
    bg.addColorStop(1, "#1c1533");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, W);
    // рамка
    ctx.strokeStyle = isFailed ? "#ff7a8a" : "#ffd23f";
    ctx.lineWidth = 8;
    const r = 36, m = 44;
    ctx.beginPath();
    ctx.moveTo(m + r, m);
    ctx.arcTo(W - m, m, W - m, W - m, r);
    ctx.arcTo(W - m, W - m, m, W - m, r);
    ctx.arcTo(m, W - m, m, m, r);
    ctx.arcTo(m, m, W - m, m, r);
    ctx.closePath();
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "800 60px sans-serif";
    ctx.fillText("Duckverse · rhythm", W / 2, 150);
    ctx.font = "260px serif";
    ctx.fillText(petEmoji || "🐾", W / 2, 400);
    ctx.fillStyle = "#cbd2dc";
    ctx.font = "700 50px sans-serif";
    ctx.fillText(petName, W / 2, 580);
    ctx.fillStyle = isFailed ? "#ff7a8a" : "#1ad17a";
    ctx.font = "800 44px sans-serif";
    ctx.fillText(isFailed ? "FAILED" : "CLEARED", W / 2, 650);
    ctx.fillStyle = "#ffd23f";
    ctx.font = "800 150px sans-serif";
    ctx.fillText("♪ " + st.score.toLocaleString(), W / 2, 780);
    ctx.fillStyle = "#cbd2dc";
    ctx.font = "600 46px sans-serif";
    ctx.fillText(`${accPct}%  ·  max combo ${st.maxCombo}`, W / 2, 890);
    ctx.fillStyle = "#b89bf0";
    ctx.font = "700 40px sans-serif";
    ctx.fillText(`#${SHARE_HASHTAG} · skill-to-earn on Robinhood Chain`, W / 2, 980);
    return c;
  }

  // Поделиться результатом: на мобильных — нативный шеринг картинки прямо в X;
  // иначе — скачать PNG и открыть окно твита (картинку прикрепить вручную).
  async function shareResult() {
    try {
      const canvas = drawCard();
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/png"));
      if (!blob) return;
      const text = `I scored ${statsRef.current.score.toLocaleString()} in Duckverse rhythm! 🎵 #${SHARE_HASHTAG}`;
      const file = new File([blob], "duckverse-rhythm.png", { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return;
      }
      // Фолбэк (десктоп): скачать картинку и открыть окно твита.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "duckverse-rhythm.png";
      a.click();
      URL.revokeObjectURL(url);
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
    } catch {
      /* отмена/ошибка шеринга — игнор */
    }
  }

  const now = clockRef.current;
  const s = statsRef.current;
  const total = s.perfect + s.good + s.miss;
  const acc = total ? Math.round(((s.perfect + s.good * 0.5) / total) * 100) : 100;
  const judge = judgeRef.current && now - judgeRef.current.at < 480 ? judgeRef.current : null;
  const mult = comboMult(s.combo);
  const tierPop = now - tierPopRef.current < 600;

  // Пока заезд идёт (done === false), клик мимо окна НЕ закрывает игру: раньше так можно было
  // случайно оборвать забег на середине. Выйти можно только крестиком, и только после финиша.
  return (
    <div className="scrim scrim-top" onClick={() => done && onClose()}>
      <div className="modal rg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🎵 Rhythm</h3>
          <span className="rg-hud">
            <b className="rg-score">♪ {s.score.toLocaleString()}</b>
            <span className="rg-sub">
              Combo {s.combo}
              {mult > 1 && <span className={"rg-mult" + (tierPop ? " rg-mult-pop" : "")}> ×{mult.toFixed(1)}</span>}
              {" "}· {acc}% · <span className="rg-miss">{s.miss}/{MAX_MISS}✗</span>
            </span>
          </span>
        </div>

        {!done && <p className="subtitle" style={{ marginTop: 0 }}>Hit the notes with G H J K (or tap the lanes)</p>}

        {!done && (
          <div className="rg-pet" title={`${petName} is playing with you!`}>
            <span className="rg-pet-bob">
              <span className={"rg-pet-scale" + (now - reactRef.current < 160 ? " rg-pet-hit" : "")}>
                <PetArt species={petSpecies} size={68} />
              </span>
            </span>
          </div>
        )}

        <div className="rg-field" style={{ width: LANE_W * LANES, height: FIELD_H }}>
          {Array.from({ length: LANES }, (_, lane) => (
            <div
              key={lane}
              className={"rg-lane" + (now - flashRef.current[lane] < 90 ? " rg-lane-on" : "")}
              style={{ left: lane * LANE_W, width: LANE_W }}
              onPointerDown={(e) => { e.preventDefault(); hitLane(lane); }}
            />
          ))}

          <div className="rg-hitline" style={{ top: HIT_Y }} />

          {notesRef.current.map((n) => {
            if (n.hit && n.hit !== "miss") return null;
            const y = HIT_Y * (1 - (n.t - now) / n.approach);
            if (y < -NOTE_H || y > FIELD_H) return null;
            if (n.hit === "miss" && now > n.t + 250) return null;
            return (
              <div
                key={n.id}
                className="rg-note"
                style={{ left: n.lane * LANE_W + 4, width: LANE_W - 8, height: NOTE_H, top: y, background: LANE_COLORS[n.lane], opacity: n.hit === "miss" ? 0.25 : 1 }}
              />
            );
          })}

          {judge && <div className={"rg-judge rg-" + judge.kind}>{judge.kind === "perfect" ? "PERFECT" : judge.kind === "good" ? "GOOD" : "MISS"}</div>}

          <div className="rg-keys" style={{ top: HIT_Y + 6 }}>
            {KEY_LABEL.map((k, lane) => (
              <span key={lane} className="rg-key" style={{ width: LANE_W }}>{k}</span>
            ))}
          </div>
        </div>

        {done ? (
          <div className="rg-summary">
            <p className={"rg-result " + (failed ? "rg-miss" : "")}>{failed ? `💀 Failed — ${MAX_MISS} misses` : "🎉 Cleared!"}</p>
            <div className="rg-bigscore">♪ {s.score.toLocaleString()}</div>
            <p className="subtitle" style={{ marginTop: 2 }}>
              {acc}% · max combo {s.maxCombo} · <span className="rg-perfect">{s.perfect}P</span> <span className="rg-good">{s.good}G</span> <span className="rg-miss">{s.miss}M</span>
            </p>
            <button className="btn btn-share" onClick={shareResult}>𝕏 Share result</button>
            <div className="actions">
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={() => setRunId((r) => r + 1)}>Play again</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
