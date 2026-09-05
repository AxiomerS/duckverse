// Рулетка: сколько миллисекунд лента крутится перед показом результата.
export const SPIN_MS = 5200;

// Синтезированный звук "открытия кейса": замедляющиеся тики `dur` секунд, затем динь.
// Сделан на Web Audio API, так что аудиофайл не нужен.
export function playSpinSound(dur = 4) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const start = ctx.currentTime;
    const click = (time: number, freq: number, vol: number, len: number, type: OscillatorType = "square") => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vol, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + len);
      osc.connect(g).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + len + 0.02);
    };
    let t = 0;
    let gap = 0.045;
    while (t < dur) {
      click(start + t, 560 + Math.random() * 220, 0.12, 0.04);
      t += gap;
      gap *= 1.12; // тики замедляются к концу
    }
    click(start + dur + 0.05, 880, 0.3, 0.5, "sine"); // финальный динь
    setTimeout(() => ctx.close(), (dur + 1.2) * 1000);
  } catch {
    /* аудио недоступно — игнорируем */
  }
}

// Одна нота с мягкой огибающей (общий помощник для джинглов).
function tone(ctx: AudioContext, freq: number, start: number, dur: number, vol: number, type: OscillatorType = "triangle") {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.03);
}

// Захватывающий звук выигрыша: восходящее мажорное арпеджио + сверкающий аккорд.
export function playWinSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const t = ctx.currentTime;
    const arp = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    arp.forEach((f, i) => tone(ctx, f, t + i * 0.085, 0.2, 0.18, "square"));
    // финальный сверкающий аккорд
    [1046.5, 1318.5, 1567.98].forEach((f) => tone(ctx, f, t + 0.36, 0.6, 0.12, "triangle"));
    setTimeout(() => ctx.close(), 1300);
  } catch {
    /* аудио недоступно — игнорируем */
  }
}

// Мягкий короткий "клик" при выборе питомца в списке — двухнотный восходящий блип.
export function playSelectSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const t = ctx.currentTime;
    tone(ctx, 660, t, 0.08, 0.14, "triangle");
    tone(ctx, 880, t + 0.045, 0.1, 0.14, "triangle");
    setTimeout(() => ctx.close(), 350);
  } catch {
    /* аудио недоступно — игнорируем */
  }
}

// Едва слышный "тук" при открытии обычной модалки (Shop, Inventory, Ranks и т.д.) — тише и короче
// select-звука, чтобы не надоедать при частом открытии/закрытии панелей.
export function playModalSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const t = ctx.currentTime;
    tone(ctx, 520, t, 0.07, 0.08, "sine");
    setTimeout(() => ctx.close(), 250);
  } catch {
    /* аудио недоступно — игнорируем */
  }
}

// Радостный "монетный" звон при получении daily-награды: короткое восходящее трезвучие.
export function playDailySound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const t = ctx.currentTime;
    [523.25, 659.25, 987.77].forEach((f, i) => tone(ctx, f, t + i * 0.06, 0.22, 0.16, "triangle"));
    setTimeout(() => ctx.close(), 500);
  } catch {
    /* аудио недоступно — игнорируем */
  }
}

// Утешительный звук проигрыша: мягкое нисходящее «ва-ва».
export function playLoseSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const t = ctx.currentTime;
    const seq = [392.0, 329.63, 261.63]; // G4 → E4 → C4
    seq.forEach((f, i) => tone(ctx, f, t + i * 0.17, 0.3, 0.16, "sine"));
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* аудио недоступно — игнорируем */
  }
}
