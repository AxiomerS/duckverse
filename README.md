<div align="center">

# 🦆 Duckverse

### Raise a robot duck. Keep it charged. Earn DuckCoin.

Qwak!

</div>

---

## What it is

Duckverse is a browser game where you adopt a small robot duck and raise it.

You **feed it, play with it, and keep its stats up** — neglect it and it gets weak. Along the
way you **open chests**, **collect rarer duck models and gear**, **level up**, **breed new
ducks**, run **quests**, and prove your skill in **two minigames** (a 4-lane rhythm track and a
battle arena). Progress, leaderboards, PvP and the marketplace are backed by a Supabase cloud
with wallet-signature auth.

It runs on **Robinhood Chain** (Arbitrum Orbit L2, chain id `4663`). The chain has no native
token, so gas and payments are both **ETH**.

## Currency

- **DC (DuckCoin)** — the in-game currency. Earned by playing; spent on food, chests, gear,
  potions, breeding and revives. The balance is **server-authoritative** (a `balances` table
  plus atomic SQL functions); the client only mirrors it.
- **ETH** — the real-money layer: buying DC, the marketplace, and quest payouts.

**$DC is not launched.** The plan is to launch it on Robinhood Chain paired with the NVDA RWA
token. Until it exists on-chain, `TOKEN_CA` in `src/App.tsx` stays empty and the in-game token
panel shows "not launched". Do not put an address there before the real deploy.

## The ducks

14 models across five rarities. The three common ones are starters; everything rarer drops
from the Duck Chest or comes from breeding. Each rare-or-better model has one permanent perk
while it is the active duck.

| Rarity | Models |
| --- | --- |
| Common | Cream, Graphite, Sky |
| Rare | Lavender, Moss, Frost |
| Epic | Ember, Tuxedo, Night |
| Legendary | Chrome, Volt, Prism |
| Mythic | Golden, Eternal |

Cream, Graphite, Lavender and Sky are the four official Microduck colourways; the other ten
are recolours of the same renders, so the whole roster reads as one product line.

## The voice

Every duck has **its own voice**. `src/game/qwak.ts` is a Web Audio port of the voice
synthesiser from the real Microduck robot — harmonic oscillator, vibrato, jitter, AM buzz and
breath, all shaped by a "personality" derived from a seed. The seed is the species id, so a
given model always sounds like itself, while each click gives a slightly different call.

No audio files are shipped; the "wak" is computed at play time. See
[NOTICE.md](NOTICE.md) for the licence and the list of changes from the original.

## Getting started

```bash
npm install
npm run dev
```

Then open <http://127.0.0.1:5173>.

The game runs fully offline with local saves. For cloud saves, leaderboards, PvP and the
marketplace, copy `.env.example` to `.env.local` and fill in your own Supabase project:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

`supabase/marketplace.sql` contains every table, RLS policy and SQL function; it is
append-only and safe to re-run in full. The edge functions in `supabase/functions/` have no
external dependencies and are deployed from the Supabase editor.

> **Never commit real keys.** `.env*` is gitignored (except `.env.example`). Server-side
> secrets belong in Supabase Edge Function secrets and are read with `Deno.env.get`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm run build` | Type-check (`tsc -b`) then production build |
| `npm run lint` | ESLint over the project |
| `npm run preview` | Serve the production build |

## Layout

```
src/
  App.tsx          the whole game component: state, tick, economy, all modals
  game/            pure logic and data — pets, foods, chests, accessories, potions,
                   quests, rarity, power, mechanics, save, cloud, wallet, pay, chain,
                   audio, qwak (duck voice)
  components/      PetArt (duck rendering), RhythmGame, BattleGame, Roulette, ui
public/ducks/      the four Microduck colourway renders
supabase/          edge functions + marketplace.sql
art/               original SVG duck set, kept as a drop-in fallback for PetArt
third_party/       licences of ported third-party code
```

## Credits

Microduck is a product of [Pollen Robotics](https://pollen-robotics.com/microduck/). Duckverse
is a fan project and is not affiliated with, endorsed by, or sponsored by Pollen Robotics,
Hugging Face or NVIDIA. See [NOTICE.md](NOTICE.md).
