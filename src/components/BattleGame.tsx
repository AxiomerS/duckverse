import { useEffect, useRef, useState } from "react";
import { PetArt } from "./PetArt";
import { ACCESSORIES, SLOTS } from "../game/accessories";
import { RARITY } from "../game/rarity";
import { PETS } from "../game/pets";
import { loadoutPower, simulateBattle, hashSeed, pickLootAccessory, accPower, accHp, accCrit, type Loadout, type SimStep } from "../game/power";
import { type ArenaRow, type PvpProfile, type BattleQueueResult } from "../game/cloud";
import { shortAddress } from "../game/wallet";
import { playQwak } from "../game/qwak";

const BOT_NAMES = ["Qwakstorm", "Shadowbill", "Bolt", "Tankwing", "Nibbles", "Vortex", "Pixelbeak", "Goliath", "Sneakduck", "Turbofeather", "Mochi", "Crashlanding", "Zephyr", "Onyxbill"];
const TIPS = [
  "Epic+ accessories add crit chance & crit damage.",
  "Feed epic+ food before a fight for a temporary power boost.",
  "Accessories add HP too — heavier gear survives longer.",
  "Crit chance has diminishing returns and caps at 25%.",
  "Higher level means more power and more HP.",
];

// Ставки на бой (Sil). 0 = дружеский бой без ставки.
const BET_OPTIONS = [0, 25, 50, 100, 200];
const INTRO_MS = 2600; // сколько держим экран "pet1 VS pet2" перед рулеткой (кто бьёт первым)
const FLIP_MS = 4000; // длительность рулетки "кто бьёт первым" — держать в синхроне с .bt-arrow transition в App.css

// Ранкинг арены — топ-игроки (локальный/фейковый; настоящий глобальный лист будет с бэкендом).
// У каждого — винрейт и лучший питомец с его силой.
type ArenaPlayer = { name: string; wins: number; losses: number; species: string; power: number };
const ARENA_PLAYERS: ArenaPlayer[] = [
  { name: "GoldenQwak", wins: 312, losses: 21, species: "dragon", power: 690 },
  { name: "ObsidianBill", wins: 288, losses: 26, species: "dino", power: 655 },
  { name: "VoltWing", wins: 254, losses: 33, species: "tiger", power: 610 },
  { name: "PrismQuack", wins: 240, losses: 40, species: "unicorn", power: 585 },
  { name: "ChromeBeak", wins: 221, losses: 44, species: "lion", power: 560 },
  { name: "EmberBeak", wins: 198, losses: 52, species: "fox", power: 520 },
  { name: "TurboSprout", wins: 176, losses: 58, species: "frog", power: 480 },
  { name: "PixelTux", wins: 160, losses: 66, species: "panda", power: 455 },
  { name: "MidnightQwak", wins: 143, losses: 71, species: "owl", power: 420 },
  { name: "BassDrop", wins: 128, losses: 79, species: "rabbit", power: 390 },
  { name: "FrostFeather", wins: 112, losses: 84, species: "penguin", power: 360 },
  { name: "CarbonByte", wins: 98, losses: 90, species: "cat", power: 330 },
  { name: "ScoutUnit01", wins: 84, losses: 92, species: "dog", power: 300 },
  { name: "SunnyBolt", wins: 71, losses: 95, species: "hamster", power: 275 },
  { name: "LuckyChrome", wins: 63, losses: 101, species: "lion", power: 250 },
  { name: "StormVolt", wins: 52, losses: 108, species: "tiger", power: 225 },
  { name: "MistyEmber", wins: 44, losses: 115, species: "fox", power: 200 },
  { name: "EchoNight", wins: 37, losses: 121, species: "owl", power: 180 },
  { name: "RookieDuck", wins: 25, losses: 130, species: "dog", power: 150 },
  { name: "NewbieQwak", wins: 12, losses: 140, species: "cat", power: 120 },
];

type Phase = "loadout" | "searching" | "intro" | "flip" | "battle" | "done";
type Fighter = { name: string; species: string; level: number; accessories: string[] } & Loadout;
// bot — случайный фейковый соперник; async — снимок профиля реального игрока (он об этом не знает);
// live — настоящий live-матч (оба игрока сейчас в очереди, исход детерминирован для обеих сторон).
type MatchKind = "bot" | "async" | "live";

export function BattleGame({ onClose, onWin, onWinNoLoot, onLose, petName, petSpecies, level, accessories, loadout, powerBuffActive, wins, losses, coins, health, arenaTop, myWallet, onlineEnabled, fetchOpponent, queuePoll, queueLeave, queueFinish }: {
  onClose: () => void;
  // Победа в LIVE-матче с трофеем: предмет реально забирается у соперника (см. onLose lostAccessoryId).
  onWin: (kind: "accessory" | "food", id: string, bet: number) => void;
  onWinNoLoot: (bet: number) => void; // победа без трофея (async/bot, или live без снаряжения у соперника) — DC+XP
  // lostAccessoryId — задан только для LIVE-поражения, когда у меня реально забрали надетый аксессуар
  // (выбор детерминирован — см. pickLootAccessory в power.ts, победитель вычисляет то же самое).
  onLose: (bet: number, lostAccessoryId?: string | null) => void;
  petName: string;
  petSpecies: string;
  level: number;
  accessories: string[];
  loadout: Loadout;
  powerBuffActive: number;
  wins: number;
  losses: number;
  coins: number;
  health: number;
  arenaTop: ArenaRow[] | null; // живой топ арены из Supabase (null → фейковый список)
  myWallet: string | null;
  onlineEnabled: boolean; // доступен ли онлайн-матч (кошелёк + облако)
  fetchOpponent: () => Promise<PvpProfile | null>; // async-фолбэк: снимок случайного реального игрока
  queuePoll: (fighter: { name: string; species: string; level: number; accessories: string[]; bet: number }) => Promise<BattleQueueResult | null>;
  queueLeave: () => Promise<void>;
  queueFinish: (matchId: string) => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("loadout");
  const [bot, setBot] = useState<Fighter | null>(null);
  const [pHp, setPHp] = useState(0);
  const [oHp, setOHp] = useState(0);
  const [pMax, setPMax] = useState(1);
  const [oMax, setOMax] = useState(1);
  const [turn, setTurn] = useState(0);
  const [flash, setFlash] = useState<{ attacker: "p" | "o"; side: "p" | "o"; dmg: number; crit: boolean } | null>(null);
  const [win, setWin] = useState(false);
  const [lootLabel, setLootLabel] = useState<string | null>(null); // имя добытого предмета (для экрана done)
  const [arrowSpin, setArrowSpin] = useState(0); // угол стрелки «кто бьёт первым»
  const [bet, setBet] = useState(0); // ставка Sil на бой
  const [showRanks, setShowRanks] = useState(false); // показать ли ранкинг арены
  const [matchKind, setMatchKind] = useState<MatchKind>("bot"); // текущий бой — bot/async/live
  const timerRef = useRef(0);
  const resultedRef = useRef(false);
  const betRef = useRef(0); // зафиксированная ставка на текущий бой
  const searchIdRef = useRef(0); // токен текущего поиска (для отмены/перезапуска)
  const matchIdRef = useRef<string | null>(null); // id текущего live-матча (для очистки очереди)
  const scriptRef = useRef<{ steps: SimStep[]; myRole: "A" | "B" } | null>(null); // сценарий live-боя
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  // Актуальные phase/matchKind для cleanup-эффекта с пустыми deps (иначе замыкание видело бы только
  // значения на момент монтирования, а не на момент реального закрытия/размонтирования).
  const phaseRef = useRef<Phase>("loadout");
  const matchKindRef = useRef<MatchKind>("bot");
  // Пишем в рефы ПОСЛЕ рендера, а не в его теле: запись во время рендера ломает предсказуемость
  // и справедливо ловится линтером. Эффект без списка зависимостей идёт после каждого рендера,
  // поэтому к моменту размонтирования в рефах лежат актуальные значения — ровно то, что нужно
  // cleanup-эффекту ниже.
  useEffect(() => {
    phaseRef.current = phase;
    matchKindRef.current = matchKind;
  });

  const MIN_HP = 10; // нужно минимум 10 HP, чтобы выйти на арену
  const canFight = health >= MIN_HP;

  // Ушёл (клик мимо / закрыл модалку) прямо во время LIVE-матча (уже нашли соперника, идёт заставка
  // или сам бой) — засчитывается как поражение (форфейт), иначе можно было сбежать без последствий,
  // пока соперник честно доигрывает свою сторону детерминированного боя и получает победу/поражение.
  function leaveOrForfeit() {
    if (matchKindRef.current === "live" && !resultedRef.current && (phaseRef.current === "intro" || phaseRef.current === "flip" || phaseRef.current === "battle")) {
      resultedRef.current = true;
      onLose(betRef.current, null); // трофей не трогаем — бой не был доигран честно
    }
    if (matchIdRef.current) { queueFinish(matchIdRef.current); matchIdRef.current = null; }
    else queueLeave(); // ещё не matched (просто искали) — best-effort выйти из очереди
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    leaveOrForfeit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Случайный противник: случайный вид, уровень рядом с твоим и случайное снаряжение.
  function makeBot(): Fighter {
    const lvl = Math.max(1, level + Math.floor(Math.random() * 5) - 2);
    const accs: string[] = [];
    for (const s of SLOTS) {
      if (Math.random() < 0.6) {
        const pool = ACCESSORIES.filter((a) => a.type === s.type);
        accs.push(pool[Math.floor(Math.random() * pool.length)].id);
      }
    }
    const species = PETS[Math.floor(Math.random() * PETS.length)].id;
    const rarity = PETS.find((p) => p.id === species)?.rarity ?? "common";
    const lo = loadoutPower(lvl, accs, Math.random() < 0.3 ? 0.1 : 0, rarity);
    return { name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], species, level: lvl, accessories: accs, ...lo };
  }

  // Построить бойца из профиля реального игрока (его вид, уровень, снаряжение).
  async function buildOnlineFighter(): Promise<Fighter | null> {
    const prof = await fetchOpponent();
    if (!prof) return null;
    const rarity = PETS.find((p) => p.id === prof.species)?.rarity ?? "common";
    const lo = loadoutPower(prof.level, prof.accessories ?? [], 0, rarity);
    return { name: (prof.name && prof.name.trim()) || "Rival", species: prof.species, level: prof.level, accessories: prof.accessories ?? [], ...lo };
  }

  // Построить бойца из снимка live-соперника (те же поля, что и у async-профиля).
  function fighterFromProfile(prof: PvpProfile): Fighter {
    const rarity = PETS.find((p) => p.id === prof.species)?.rarity ?? "common";
    const lo = loadoutPower(prof.level, prof.accessories ?? [], 0, rarity);
    return { name: (prof.name && prof.name.trim()) || "Rival", species: prof.species, level: prof.level, accessories: prof.accessories ?? [], ...lo };
  }

  // Показать заставку "pet1 VS pet2" (с их шмотками), затем «бросок стрелки» и сам бой.
  // first — кто бьёт первым; для live-матчей задаётся заранее сценарием (одинаково у обеих сторон),
  // для bot/async — честный локальный случай (никому кроме тебя этот бой не важен).
  function startFlip(b: Fighter, kind: MatchKind, first?: boolean) {
    setMatchKind(kind);
    setBot(b);
    setPMax(loadout.hp); setPHp(loadout.hp); setOMax(b.hp); setOHp(b.hp);
    setPhase("intro");
    playQwak(b.species); // соперник здоровается своим голосом, пока держится заставка VS
    timerRef.current = window.setTimeout(() => {
      const f = first ?? Math.random() < 0.5;
      setArrowSpin(0);
      setPhase("flip");
      requestAnimationFrame(() => setArrowSpin(360 * 5 + (f ? 180 : 0)));
      timerRef.current = window.setTimeout(() => startBattle(b, f, kind), FLIP_MS);
    }, INTRO_MS);
  }

  // Запустить LIVE-матч: строим сценарий боя ОДИНАКОВО на обеих сторонах (детерминированный ГСЧ,
  // seed = хэш общего match_id) — см. simulateBattle в power.ts. "A"/"B" — канонический порядок по
  // сравнению кошельков (не "я"/"соперник"), чтобы оба клиента согласованно расставили роли.
  // ВАЖНО: `loadout` (проп) включает МОЙ временный бафф силы от еды/зелья — соперник о нём ничего
  // не знает и не может воспроизвести buffed-силу у себя, из-за чего оба клиента считали РАЗНЫЙ бой
  // и каждый видел победу у себя. Баффы не влияют на hp/critChance/critMult (только на power), так
  // что для live-расчёта пересчитываем СВОЮ силу канонически (без баффа) — идентично тому, как
  // соперник её же вычисляет из моего профиля.
  function startLiveMatch(matchId: string, opp: PvpProfile & { wallet: string }) {
    matchIdRef.current = matchId;
    const fighter = fighterFromProfile(opp);
    const oppLoadout: Loadout = fighter; // { power, hp, critChance, critMult } — уже посчитано выше
    const myRarity = PETS.find((p) => p.id === petSpecies)?.rarity ?? "common";
    const myCanonical: Loadout = loadoutPower(level, accessories, 0, myRarity);
    const iAmA = !!myWallet && myWallet < opp.wallet;
    const [fA, fB] = iAmA ? [myCanonical, oppLoadout] : [oppLoadout, myCanonical];
    const sim = simulateBattle(fA, fB, hashSeed(matchId));
    const myRole: "A" | "B" = iAmA ? "A" : "B";
    scriptRef.current = { steps: sim.steps, myRole };
    startFlip(fighter, "live", sim.steps[0].attacker === myRole);
  }

  // Найти соперника. Сначала 30 сек честно ищем LIVE-матч (второй игрок сейчас тоже в поиске) —
  // оба узнают об этом в реальном времени и дерутся синхронно. Не нашли за 30с → покидаем очередь
  // и одна попытка на async-фолбэк (снимок случайного реального игрока, он об этом не узнает,
  // добычу за победу над ним не выдаём — только настоящий live-соперник её "теряет"). Бот — только
  // если реальных игроков вообще нет ни в очереди, ни среди сохранённых профилей.
  const ONLINE_TIMEOUT = 30000; // 30 секунд на поиск live-соперника
  function beginMatch() {
    if (!canFight) return;
    betRef.current = Math.min(bet, coins); // фиксируем ставку на этот бой
    const myId = ++searchIdRef.current;
    setPhase("searching");
    if (!onlineEnabled) {
      timerRef.current = window.setTimeout(() => { if (searchIdRef.current === myId) startFlip(makeBot(), "bot"); }, 900);
      return;
    }
    // Отсчёт стартуем при первом опросе, а не здесь: Date.now() в теле функции компонента
    // компилятор React считает вызовом во время рендера, хотя попадают сюда только по клику.
    // poll() запускается несколькими строками ниже, так что момент отсчёта тот же.
    let deadline = 0;
    const poll = () => {
      if (!deadline) deadline = Date.now() + ONLINE_TIMEOUT;
      queuePoll({ name: petName, species: petSpecies, level, accessories, bet: betRef.current }).then((r) => {
        if (searchIdRef.current !== myId) return; // поиск отменён/перезапущен
        if (r?.status === "matched" && r.matchId && r.opponent) return startLiveMatch(r.matchId, r.opponent);
        if (Date.now() >= deadline) {
          queueLeave(); // не нашли живого соперника вовремя — уходим из очереди
          buildOnlineFighter().then((found) => {
            if (searchIdRef.current !== myId) return;
            startFlip(found ?? makeBot(), found ? "async" : "bot");
          });
          return;
        }
        timerRef.current = window.setTimeout(poll, 1500); // подождём и попробуем снова
      });
    };
    poll();
  }

  // Отменить поиск и вернуться в лоадаут.
  function cancelSearch() {
    searchIdRef.current++; // сбрасываем текущий поиск
    if (timerRef.current) clearTimeout(timerRef.current);
    queueLeave();
    setPhase("loadout");
  }

  // kind==="live" → каждый ход берётся из заранее просчитанного детерминированного сценария
  // (scriptRef, одинакового на обеих сторонах матча) вместо Math.random() — иначе оба участника
  // могли бы независимо "выиграть" у себя локально.
  function startBattle(b: Fighter, first: boolean, kind: MatchKind) {
    let p = loadout.hp;
    let o = b.hp;
    setPMax(p); setOMax(o); setPHp(p); setOHp(o);
    setPhase("battle");
    let playerTurn = first;
    const script = kind === "live" ? scriptRef.current : null;
    let stepIndex = 0;
    const step = () => {
      let crit: boolean, dmg: number;
      if (script) {
        const s = script.steps[stepIndex++];
        crit = s.crit; dmg = s.dmg;
        playerTurn = s.attacker === script.myRole;
      } else {
        const atk = playerTurn ? loadout : b;
        crit = Math.random() < atk.critChance;
        dmg = Math.round(atk.power * (crit ? atk.critMult : 1));
      }
      if (playerTurn) { o = Math.max(0, o - dmg); setOHp(o); } else { p = Math.max(0, p - dmg); setPHp(p); }
      setFlash({ attacker: playerTurn ? "p" : "o", side: playerTurn ? "o" : "p", dmg, crit });
      setTurn((t) => t + 1);
      if (p <= 0 || o <= 0) {
        const w = playerTurn;
        timerRef.current = window.setTimeout(() => {
          setWin(w);
          const matchId = matchIdRef.current;
          if (w) {
            // LIVE-победа: трофей — детерминированно выбранный аксессуар соперника (тот же расчёт,
            // что и на его стороне, см. pickLootAccessory) — реально забирается у него (не выбор
            // из вариантов, чтобы обеим сторонам не нужно было ничего дополнительно согласовывать).
            const lootId = kind === "live" && matchId ? pickLootAccessory(b.accessories, matchId) : null;
            if (!resultedRef.current) {
              resultedRef.current = true;
              if (lootId) onWin("accessory", lootId, betRef.current);
              else onWinNoLoot(betRef.current);
            }
            setLootLabel(lootId ? (ACCESSORIES.find((a) => a.id === lootId)?.label ?? null) : null);
          } else {
            playQwak(b.species, "honk"); // торжествует соперник; свою победу озвучивает App
            // LIVE-поражение: если у меня было надето что-то, ровно этот же расчёт (у победителя) мог
            // выбрать его трофеем — вычисляю то же самое и реально теряю предмет у себя.
            const lostId = kind === "live" && matchId ? pickLootAccessory(accessories, matchId) : null;
            if (!resultedRef.current) { resultedRef.current = true; onLose(betRef.current, lostId); }
            setLootLabel(lostId ? (ACCESSORIES.find((a) => a.id === lostId)?.label ?? null) : null);
          }
          setPhase("done");
          if (kind === "live" && matchId) { queueFinish(matchId); matchIdRef.current = null; }
        }, 900);
        return;
      }
      playerTurn = !playerTurn;
      timerRef.current = window.setTimeout(step, 850);
    };
    timerRef.current = window.setTimeout(step, 700);
  }

  // Идёт ли матч прямо сейчас: на этих фазах выход заблокирован (и крестик, и клик мимо окна).
  const inMatch = phase === "intro" || phase === "flip" || phase === "battle";
  const total = wins + losses;
  const winrate = total ? Math.round((wins / total) * 100) : 0;

  const gearRow = (accs: string[]) => (
    <div className="bt-gearrow">
      {ACCESSORIES.filter((a) => accs.includes(a.id)).map((a) => (
        <span key={a.id} className="bt-gearchip" style={{ borderColor: RARITY[a.rarity].color }} title={`${a.label} · ⚔️+${accPower(a.rarity)} ❤️+${accHp(a.rarity)}`}>{a.emoji}</span>
      ))}
      {accs.length === 0 && <span className="bt-gearchip bt-gearchip-empty">—</span>}
    </div>
  );

  return (
    <div
      className="scrim"
      onClick={() => {
        // Пока бой идёт (заставка, розыгрыш первого удара, сам бой) клик мимо окна НЕ закрывает
        // игру — иначе матч можно было оборвать случайным тычком в сторону. Выход только крестиком.
        if (inMatch) return;
        leaveOrForfeit();
        onClose();
      }}
    >
      <div className="modal modal-xl battle-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚔️ Battle Arena <span className="wip-badge">{onlineEnabled ? "PvP" : "BOTS"}</span></h3>
          {/* Только в меню: во время поиска есть Cancel, во время боя выходить нельзя,
              на экране результата закрывает кнопка Done. */}
          {phase === "loadout" && (
            <button className="modal-close-text" onClick={() => { leaveOrForfeit(); onClose(); }}>Close</button>
          )}
        </div>

        {phase === "loadout" && showRanks && (() => {
          const rate = (w: number, l: number) => (w + l ? w / (w + l) : 0);
          type Row = { key: string; name: string; wins: number; losses: number; species: string; power: number; you: boolean };
          let rows: Row[];
          const real = arenaTop !== null; // живой топ из Supabase
          if (arenaTop) {
            // Порядок уже задан запросом (по победам, затем по силе).
            rows = arenaTop.map((p) => ({
              key: p.wallet,
              name: (p.name && p.name.trim()) || shortAddress(p.wallet),
              wins: p.wins, losses: p.losses, species: p.species, power: p.power,
              you: !!myWallet && p.wallet === myWallet,
            }));
            if (myWallet && !rows.some((r) => r.you)) {
              rows.push({ key: myWallet, name: petName, wins, losses, species: petSpecies, power: loadout.power, you: true });
            }
          } else {
            const me: Row = { key: "you", name: petName, wins, losses, species: petSpecies, power: loadout.power, you: true };
            rows = [...ARENA_PLAYERS.map((p) => ({ key: p.name, name: p.name, wins: p.wins, losses: p.losses, species: p.species, power: p.power, you: false })), me]
              .sort((a, b) => b.wins - a.wins || b.power - a.power)
              .slice(0, 20);
          }
          return (
            <div className="bt-ranks">
              <p className="subtitle" style={{ marginTop: -4 }}>
                {real ? "Global top fighters — most wins first." : "Top fighters by wins & pet power."}
              </p>
              <div className="bt-ranklist">
                <div className="bt-rankhead">
                  <span className="bt-rk">#</span>
                  <span className="bt-rn">Player</span>
                  <span className="bt-rw">Winrate</span>
                  <span className="bt-rp">⚔️ Power</span>
                </div>
                {rows.length === 0 ? (
                  <div className="bt-rankrow"><span className="bt-rn">No fighters yet — win a battle! ⚔️</span></div>
                ) : (
                  rows.map((r, i) => (
                    <div key={r.key} className={"bt-rankrow" + (r.you ? " bt-rankrow-you" : "")}>
                      <span className="bt-rk">{i + 1}</span>
                      <span className="bt-rn"><PetArt species={r.species} size={22} /> {r.name}{r.you ? " (you)" : ""}</span>
                      <span className="bt-rw">{Math.round(rate(r.wins, r.losses) * 100)}%</span>
                      <span className="bt-rp">{r.power}</span>
                    </div>
                  ))
                )}
              </div>
              {real && !myWallet && <p className="bt-tip">🔌 Connect your wallet to join the global arena ranking.</p>}
              <button className="btn btn-ghost" onClick={() => setShowRanks(false)}>← Back</button>
            </div>
          );
        })()}

        {phase === "loadout" && !showRanks && (
          <div className="bt-loadout">
            <div className="bt-loadcard">
              <div className="bt-hero">
                <PetArt species={petSpecies} size={104} />
                <div className="bt-name">{petName}</div>
                <div className="bt-lvl">Level {level}</div>
                {powerBuffActive > 0 && <div className="bt-buff">🍖 +{Math.round(powerBuffActive * 100)}% power</div>}
              </div>
              <div className="bt-statbox">
                <div className="bt-bigstat bt-stat-pow"><span>⚔️ Power</span><b>{loadout.power}</b></div>
                <div className="bt-bigstat bt-stat-hp"><span>❤️ HP</span><b>{loadout.hp}</b></div>
                <div className="bt-bigstat bt-stat-crit"><span>💥 Crit</span><b>{Math.round(loadout.critChance * 100)}% · ×{loadout.critMult.toFixed(2)}</b></div>
                <div className="bt-gearlist">
                  {SLOTS.map((s) => {
                    const a = ACCESSORIES.find((x) => x.type === s.type && accessories.includes(x.id));
                    return (
                      <div className="bt-slotrow" key={s.type}>
                        <span className="bt-slotemoji">{a ? a.emoji : s.ghost}</span>
                        <span className="bt-slotname">{a ? a.label : `No ${s.label.toLowerCase()}`}</span>
                        {a && (
                          <span className="bt-slotstat" style={{ color: RARITY[a.rarity].color }}>
                            ⚔️+{accPower(a.rarity)} ❤️+{accHp(a.rarity)}{accCrit(a.rarity) ? ` 💥${Math.round(accCrit(a.rarity)!.chance * 100)}%` : ""}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Ставка на бой */}
            <div className="bt-betbox">
              <span className="bt-betlabel">💰 Bet</span>
              <div className="bt-betopts">
                {BET_OPTIONS.map((b) => (
                  <button
                    key={b}
                    className={"bt-betchip" + (bet === b ? " bt-betchip-on" : "")}
                    disabled={b > coins}
                    onClick={() => setBet(b)}
                  >
                    {b === 0 ? "None" : b}
                  </button>
                ))}
              </div>
            </div>

            {canFight ? (
              <button className="btn btn-primary bt-find" onClick={beginMatch}>
                {onlineEnabled ? "🌐 Find opponent" : "🔍 Find opponent"}{bet > 0 ? ` · bet ${bet}` : ""}
              </button>
            ) : (
              <button className="btn btn-primary bt-find" disabled>❤️ Needs {MIN_HP}+ HP to fight</button>
            )}
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setShowRanks(true)}>🏆 Rankings</button>
            </div>

            <div className="bt-info">
              <div className="bt-record">
                <div className="bt-rec"><b>{wins}</b><span>Wins</span></div>
                <div className="bt-rec"><b>{losses}</b><span>Losses</span></div>
                <div className="bt-rec"><b>{winrate}%</b><span>Winrate</span></div>
              </div>
              <p className="bt-rewards">🏆 Win: +DC, +XP{bet > 0 ? ` & +${bet} bet` : ""} (🌐 live win also loots an item) · 💔 Lose: −10 HP{bet > 0 ? ` & −${bet} bet` : ""}</p>
              {!canFight && <p className="bt-tip">❤️ Your pet is too weak to fight — heal it above {MIN_HP} HP first.</p>}
              <p className="bt-tip">💡 {tip}</p>
            </div>
          </div>
        )}

        {phase === "searching" && (
          <div className="bt-searching">
            <div className="bt-spinner">⚔️</div>
            <p className="subtitle">{onlineEnabled ? "Searching for a live opponent…" : "Finding an opponent…"}</p>
            {onlineEnabled && <p className="bt-tip">30s to match a real player live — loot an item on a live win. After that, a snapshot of a random player (or a bot) fills in, DC + XP only.</p>}
            <button className="btn btn-ghost" onClick={cancelSearch}>Cancel</button>
          </div>
        )}

        {(phase === "intro" || phase === "flip" || phase === "battle" || phase === "done") && bot && (
          <div className="bt-arena">
            <div className="bt-side">
              <span key={`p-${turn}`} className={"bt-petwrap" + (flash?.attacker === "p" ? " bt-lunge-r" : flash?.side === "p" ? " bt-hurt" : "")}><PetArt species={petSpecies} size={84} /></span>
              <div className="bt-name">{petName}</div>
              {gearRow(accessories)}
              <div className="bt-hpbar"><div className="bt-hpfill bt-hp-p" style={{ width: `${(pHp / pMax) * 100}%` }} /></div>
              <div className="bt-hpnum">❤️ {pHp} / {pMax}</div>
              {flash?.side === "p" && <div key={`pd-${turn}`} className={"bt-dmg" + (flash.crit ? " bt-dmg-crit" : "")}>-{flash.dmg}{flash.crit ? " CRIT!" : ""}</div>}
            </div>
            {phase === "flip" ? (
              <svg className="bt-arrow" style={{ transform: `rotate(${arrowSpin}deg)` }} viewBox="0 0 100 40" width="92" height="38" aria-hidden>
                <path d="M8 20 H72 M56 7 L82 20 L56 33" stroke="#ffd23f" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <div className="bt-vs">VS</div>
            )}
            <div className="bt-side">
              <span key={`o-${turn}`} className={"bt-petwrap" + (flash?.attacker === "o" ? " bt-lunge-l" : flash?.side === "o" ? " bt-hurt" : "")}><PetArt species={bot.species} size={84} /></span>
              <div className="bt-name">{bot.name} · Lv {bot.level}{matchKind === "live" ? " 🌐 LIVE" : matchKind === "async" ? " 🌐" : ""}</div>
              {gearRow(bot.accessories)}
              <div className="bt-hpbar"><div className="bt-hpfill bt-hp-o" style={{ width: `${(oHp / oMax) * 100}%` }} /></div>
              <div className="bt-hpnum">❤️ {oHp} / {oMax}</div>
              {flash?.side === "o" && <div key={`od-${turn}`} className={"bt-dmg" + (flash.crit ? " bt-dmg-crit" : "")}>-{flash.dmg}{flash.crit ? " CRIT!" : ""}</div>}
            </div>
          </div>
        )}

        {phase === "intro" && <p className="subtitle bt-flipcap">⚔️ Opponent found!</p>}
        {phase === "flip" && <p className="subtitle bt-flipcap">🎯 Spinning to decide who strikes first…</p>}

        {phase === "done" && (
          <div className="bt-resultbox">
            <p className={"rg-result " + (win ? "" : "rg-miss")}>{win ? "🏆 Victory!" : "💔 Defeat"}</p>
            <p className="subtitle">
              {win
                ? lootLabel ? `You looted ${lootLabel} and gained DC + XP.` : "You gained DC + XP."
                : lootLabel ? `${petName} lost the fight, took 10 damage, and the winner looted your ${lootLabel}.` : `${petName} lost the fight and took 10 damage. Feed it to heal up.`}
            </p>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
