# AIRTIME — SPECTRAL BLUR (tone)

> An evolution of AFTERGLOW, not a replacement. AFTERGLOW established the rule:
> a dark world where speed and rotation are the only light. SPECTRAL BLUR keeps
> every word of that and changes the *hue and feel* of the light — from pink
> neon toward **light through haze**: blue-violet-forward, spectral, dissolving.

## The reference, in one line

Deep black. Electric cyan and violet with magenta as the hot edge. A car — or a
figure — resolving out of, or dissolving into, a smear of spectral light.
Atmosphere, not hard neon. Motion read as bloom.

## What actually changed (and what did not)

**Palette leans blue-violet.** Magenta was the identity colour — the wordmark,
player one, the thing your eye went to first — and the world read pink. It is
the *hot accent* now, not the lead. The lead is the spectral hemisphere:
**cyan → iris (violet) → magenta**, in that order, the way a prism lays it out.

- `--cyan #59d0ff` and `--iris #7a5cff` join the token set. `--iris` is the new
  atmosphere hue; it was only P4/secrets before.
- **The wordmark is a spectral smear** — white-hot core bleeding through cyan
  and iris to magenta — rather than a white-to-pink fade. It reads as light
  coming off something moving, which is the whole reference in one mark.
- **Screens sit inside haze.** The veil that darkens the scene under the text
  now carries a soft iris bloom high and a fainter cyan bloom low, in the open
  right half where the arena wireframe shows through. The left text column
  stays dark for contrast.

**The world's atmosphere warmed, by a measured amount.** In `art.js` the
afterglow palette's fog lifted off pure black to a deep blue-violet
(`0x0c0b1a`), so distance dissolves into spectral haze instead of a hard black
edge; the hemisphere and key light took an iris tint (`0x1a1640` / `0x9088d8`).

**The gate held.** All of that is bounded by AFTERGLOW's own law — VOID/ASPHALT
own ≥85% of any frame — and `probe:dark` still measures the worst frame at
**92.1% dark**. The haze is atmosphere, not brightness; the moment it costs the
dark-frame budget it has gone too far, and the probe is what says so.

## The constraint that does not move

**Blur is built from geometry, never from a post pass.** The name is a trap:
"blur" must not become a screen-space blur or a bloom pipeline, because the
target hardware has no GPU to spend on it (the integrated-GPU rule). The smear
is trail ribbons, additive gradients and haze falloff — the same cheap geometry
AFTERGLOW always used, tuned to read softer. A frame that looks blurred and a
frame that is cheap to draw are the same frame here, or it does not ship.

## Voice

The text cooled with the palette. The editorial screen titles that used to
shout the personality ("SOMETHING TO BE GOOD AT") are demoted to a quiet
lowercase kicker under a confident one-word noun — the voice is still there,
it just stopped competing with the thing it labels. Copy leans atmospheric and
understated over jokey; the world is moody now, and the words should be too.

## Still open (the deeper move)

The heart of the reference — **a car dissolving into a blue-violet-magenta
light-smear** — lives in the trails, and the trails still write a single player
colour. A spectral trail (a gradient sweep along the ribbon, cyan through iris
to the player's hot colour) is the next pass. It is `trails.js` and it is
`probe:dark`-gated, so it gets measured before it ships, like everything that
adds light to this world.
