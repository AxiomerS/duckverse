# Third-party notices

## Microduck voice synthesiser (Apache-2.0)

`src/game/qwak.ts` is a TypeScript/Web Audio port of the duck voice synthesiser from
**Microduck** by **Pollen Robotics**, <https://github.com/pollen-robotics/microduck>,
files `sounds/src/personality.rs`, `sounds/src/synth.rs`, `sounds/src/voices.rs`.
Licensed under the Apache License 2.0; the full licence text is in
[`third_party/microduck/LICENSE`](third_party/microduck/LICENSE).

**Changes made to the original:**

- Ported from Rust to TypeScript and rewritten to render into a Web Audio `AudioBuffer`
  instead of a native audio stream.
- Four recipes are ported: `greet` (the "wak-wak" call), `peck`, `wheee` and `alarm`.
  `inquire`, `chirp` and `coo` are not. `alarm` is exposed in game as a victory honk.
- `wheee` is shortened: the original is a ride with a middle section the robot loops while a
  trigger is held. Here it is rendered at 1.9× speed and the loop section is cut out, leaving
  the run-up and the finish, so it works as a one-shot level-up cheer.
- The original random number generator is replaced with `mulberry32`. It is still
  deterministic per seed, but produces a different number stream, so the resulting voices
  do not match those of any physical Microduck; only the sound model is the same.
- The seed is derived from the in-game species id rather than from robot hardware.

## Microduck product renders

`public/ducks/*.webp` are renders of the Microduck robot in its four official colourways
(Cream, Graphite, Lavender, Sky). Microduck is a product of Pollen Robotics.

> **Status: permission not yet obtained.** The Apache-2.0 licence above covers the
> Microduck *source code*, not product photography or renders. These files are used here as
> placeholders. Before this repository is made public, and certainly before any commercial
> launch, either get written permission from Pollen Robotics, or replace them with original
> artwork. A hand-drawn SVG duck set built for this project is kept as a drop-in fallback.

Microduck and Pollen Robotics are trademarks of their respective owners. This project is a
fan game and is not affiliated with, endorsed by, or sponsored by Pollen Robotics,
Hugging Face or NVIDIA.
