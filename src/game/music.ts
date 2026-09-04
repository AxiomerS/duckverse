// Зацикленная чиптюн-музыка для ритм-игры. Темп берётся из getSpeed() (1.0 → 2.5),
// поэтому музыка плавно ускоряется вместе с игрой. Возвращает функцию остановки.
// Сделано на Web Audio (планировщик с упреждением), аудиофайл не нужен.
export function startMusic(getSpeed: () => number): () => void {
  let stop = () => {};
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(filter).connect(ctx.destination);

    // Прогрессия Am – F – C – G (ноты в MIDI).
    const chords = [
      [57, 60, 64],
      [53, 57, 60],
      [60, 64, 67],
      [55, 59, 62],
    ];
    const baseStep = 0.17; // длительность шага (16-я нота) при скорости 1
    const arpPat = [0, 1, 2, 1]; // какой тон аккорда играть на каждом шаге

    const note = (midi: number, time: number, dur: number, type: OscillatorType, gain: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g).connect(master);
      o.start(time);
      o.stop(time + dur + 0.03);
    };

    let step = 0;
    let nextTime = ctx.currentTime + 0.1;
    const timer = window.setInterval(() => {
      const speed = Math.max(1, Math.min(2.5, getSpeed()));
      const stepDur = baseStep / speed;
      // Запланировать все шаги, попадающие в ближайшие ~130 мс.
      while (nextTime < ctx.currentTime + 0.13) {
        const chord = chords[Math.floor(step / 4) % chords.length];
        const arpNote = chord[arpPat[step % arpPat.length] % chord.length] + 12;
        note(arpNote, nextTime, stepDur * 0.9, "triangle", 0.09); // мелодия-арпеджио
        if (step % 4 === 0) note(chord[0] - 12, nextTime, stepDur * 3.6, "sine", 0.18); // бас
        if (step % 2 === 1) note(chord[2] + 24, nextTime, stepDur * 0.4, "square", 0.03); // лёгкий блип
        step++;
        nextTime += stepDur;
      }
    }, 25);

    let stopped = false;
    stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
      setTimeout(() => ctx.close().catch(() => {}), 300);
    };
  } catch {
    /* аудио недоступно — игнор */
  }
  return () => stop();
}
