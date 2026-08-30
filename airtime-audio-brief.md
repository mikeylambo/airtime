# AIRTIME — Audio brief

> What to make, what to generate, and what must stay synthesised. Written
> against the build at `src/audio/` — every number below is read out of the
> code rather than proposed, so if the code changes this file is wrong and
> should be re-derived.

Everything in the game is currently synthesised: oscillators, filtered noise,
envelopes, no files at all. That was the right call for a build with no assets,
and it is why the engine tells the truth — it is driven straight off the
simulation. This brief replaces the parts where a file beats a synth, and
deliberately keeps the parts where it does not.

---

## 0. The one rule: what must never become a file

**The engine, the wind, the road, the tyre scrub and the bodywork stress stay
synthesised.** They are continuous and parameter-driven — `mix.js` computes a
level and a frequency for each of them every frame from speed, slip angle,
rotation rate and how many panels are out. A recorded clip has one RPM and one
load; the moment you cross-fade between clips you have a worse engine that also
costs more to ship.

The single loudest idea in the audio is the **handoff at the lip**: ground
voices out in 60 ms, air voices in over 100 ms. That is a mix move, not a
sample, and it is how a launch reads.

So: files for **rooms, crowds, the PA and music**. Synthesis for **the car**.

---

## 1. Music — five pieces, and the game is already in A minor

### Why A minor

Not a preference. The build's existing cues are already there:

| Cue | Pitch | Note |
|---|---|---|
| Music bed root | 55 Hz | **A1** |
| Score cash-out, first step | 440 Hz | **A4** |
| Named gap, three-note discovery figure | 523 / 659 / 988 Hz | **C5 – E5 – B5** |

C, E and B are all diatonic to A minor, and the cash-out starts on the tonic.
Write in **A minor** (or C major, its relative) and every scoring sound in the
game lands *inside* the music. Write in anything else and the most frequent
sound in the game — a payout — is out of key with the soundtrack, several times
a minute, for ninety seconds a round.

### The five

A round is **90 seconds**. Loops are sized so a track plays roughly once
through per round and does not audibly restart.

| File | Where it plays | Length | Feel |
|---|---|---|---|
| `menu.wav` | Title, garage, boards, mastery, options | 45–60 s loop | Slower, unhurried, no urgency. This plays while somebody reads. |
| `run-ground.wav` | **The Yard**, **The Concourse** | 60–90 s loop | Dense and level. These are the arenas where you are mostly on a surface at speed, threading. Momentum, not climbing. |
| `run-altitude.wav` | **Vertical City**, **Skyline** | 60–90 s loop | Sparser, higher, more space between events. These arenas are mostly air, and a missed landing is a long way down. Let it breathe. |
| `run-machine.wav` | **Mega Works**, **Floodway** | 60–90 s loop | Rhythmic, mechanical, forward. Both arenas route in *time* — moving targets, a direction of flow. The one place a pulse belongs. |
| `result.wav` | Result screen and the highlight reel | 10–14 s, **one-shot** | A cadence, not a loop. It resolves. |

The Gauntlet uses `run-machine`. If you only want to write three, cut
`run-altitude` and let the altitude arenas share `run-ground` — that is the
least-bad merge.

### The four constraints that actually bind

**1. It gets ducked, constantly.** A big landing drops the bed to **22 % for
0.75 s**, then releases over 0.55 s — about 1.3 seconds of hole, several times
a minute, at unpredictable moments. So:

- **No lead melody and no vocal hook.** Anything a listener would follow is
  something they will lose mid-phrase, repeatedly, and it will read as a bug.
- Put the identity in **texture, bass movement and rhythm** — things that can
  vanish for a second and come back without anyone feeling robbed.
- Test it: play the track, pull it to 22 % for a second and a half at a random
  point, bring it back. If that feels like a mistake, the part is too melodic.

**2. Nothing depends on a downbeat.** The player is not on your grid. Music
that implies "the hit lands on the 1" is fighting a game where the hit lands
whenever they stick it. Around **96–120 BPM**, and avoid arrangements that need
a specific bar to make sense.

**3. Leave the car its frequencies.** Measured off the synth voices:

| Band | Occupied by | What that means for you |
|---|---|---|
| **40–140 Hz** | Engine fundamental (46–132 Hz), landing sub (130→40 Hz sweep) | Keep the low end **tight and mid-forward**. A sub-heavy track masks the landing thump, which is how the player knows a stick was clean. High-pass around 60–80 Hz. |
| **440–1200 Hz** | Score cash-out (440 Hz climbing per facet), gap figure (523/659/988 Hz) | The busiest band in the game. Keep melodic content here sparse. |
| **1200–2200 Hz** | Coins (1180→1760 Hz), tyre chirp (2100 Hz), scrub (1400–2100 Hz) | Go easy on hats, shakers and bright percussion. |
| **140–440 Hz** and **above 3 kHz** | Nothing | **Yours.** Body and air are where the music can live without a fight. |

**4. It has to loop dead.** Bar-aligned, whole number of bars, and the reverb
and delay tails from the end wrapped into the head so the seam is silent.

### Deliver as WAV

**48 kHz, 24-bit (or 16-bit) WAV**, stereo, and tell me the **BPM and bar
count**. Not MP3: MP3 encoders add padding at the head and tail that makes
gapless looping impossible in a browser. I will compress for shipping and set
exact sample loop points in Web Audio, which sidesteps the problem entirely —
but only if I start from an unpadded master.

Level: master to about **−16 LUFS integrated, true peak ≤ −1.5 dBTP**. Do not
squash it — the game runs its own compressor (−14 dB threshold, 6:1) and a
limiter-flattened track arrives already fighting it. I set the in-game gain,
so do not pre-attenuate.

Drop them in `public/audio/music/`.

---

## 2. ElevenLabs — the generated set

Thirteen files, all **P1** unless marked. Prompts are written to describe
*sound*, not story, because that is what the model is good at.

Everything here wants to **loop** except the crowd one-shots — if there is a
loop toggle, use it; if a clip comes back shorter than asked for, that is fine,
I will loop it in code.

Deliver as **WAV** where the tool offers it, otherwise whatever it gives.
Directory in brackets.

### 2.1 Room tone — one per arena `[public/audio/room/]`

The biggest single win available. Six arenas currently share one synthesised
room, so The Yard and a covered transit hall sound identical. These play as a
continuous quiet bed under everything.

**Target: 20–30 s, seamless loop, no musical content, no sudden events.**

- **`park.wav`** — Open-air empty lot at night. Distant low wind moving across
  concrete, faint traffic hum a long way off, occasional creak of metal
  fencing. Wide, dry, nothing close to the microphone. No birds, no people.

- **`city.wav`** — Rooftop ambience above a city at night. Distant traffic
  wash, the low drone of ventilation and air-conditioning plant, a far-off siren
  once, wind moving between tall buildings. Elevated and open, never street
  level.

- **`works.wav`** — Heavy industrial plant, running but unattended. Deep motor
  hum, slow rhythmic clanking of machinery in the distance, hydraulic hiss,
  metal structures ticking under load. Continuous and mechanical, no voices.

- **`flood.wav`** — Vast empty concrete drainage channel. Wind funnelling
  through the canal with a hollow resonance, water dripping and trickling with
  long slap-back echo off concrete walls. Cavernous, damp, deserted.

- **`sky.wav`** — High altitude, hundreds of metres up. Steady wind at height
  with no obstruction, steel cables humming and singing in the wind, distant
  structural groan of a tall structure flexing. Thin, cold, exposed, nothing
  below.

- **`hall.wav`** — Enormous empty transit terminal at night. Long reverberant
  tail, faint hum of overhead lighting, a distant unintelligible tannoy
  announcement once, occasional far-off mechanical rumble. Cathedral-sized
  interior, hard surfaces, muffled and echoing.

### 2.2 Crowd `[public/audio/crowd/]`

There is a crowd model already (`mix.js` swells it on airtime and reactions);
these give it a voice.

- **`bed.wav`** — 20–30 s **loop**. *A distant crowd of a few hundred people
  murmuring and talking quietly, heard from across a large open space. No
  individual voices distinguishable, no cheering, no music. Low, constant,
  slightly reverberant.*

- **`swell.wav`** — 3–4 s **one-shot**. *A distant crowd drawing breath and
  rising in anticipation, building steadily without resolving. Ends on the
  rise.*

- **`cheer.wav`** — 4–6 s **one-shot**. *A distant crowd erupting into a sharp
  cheer and applause, peaking immediately then decaying naturally over several
  seconds. Heard from far away across open ground, reverberant, no individual
  voices.*

### 2.3 The PA `[public/audio/pa/]` — read the note first

`src/audio/pa.js` argues, at length, that the PA should **not** be words:

> a tannoy two hundred metres away, band-limited to a telephone, syllabic
> rather than semantic … You know somebody announced something. You could not
> repeat it. That is the correct amount of information.

The reasoning was budget, localisation, and a line you have heard four hundred
times by hour three. ElevenLabs removes the first two and makes the third
tractable. **The third is still the real one, and it is your call.** I would
keep it wordless — it is the more distinctive choice and it never ages — so
these prompts are for the wordless version. Say the word and I will spec a
line set instead.

Four variants, 2–4 s each, so it never repeats twice running:

- **`tannoy-1.wav`** through **`tannoy-4.wav`** — *A public address
  announcement heard from two hundred metres away across an open space,
  completely unintelligible. Male voice, heavily band-limited like an old
  loudspeaker, distorted and slapping back off hard surfaces. The rhythm and
  cadence of speech are clear but no words can be made out. Four to seven
  syllables, ending on a downward inflection.*

  Vary between takes: one shorter and clipped, one longer, one with a rising
  question inflection, one more distant and washed out.

### 2.4 Impacts — **P2, optional** `[public/audio/hit/]`

The landing is already four synth layers stacked in the order the car
experiences them — contact crunch, sub thump, suspension packing, tyre chirp —
and it scales continuously with impact velocity. A single clip cannot do that,
so these would **layer under** the existing synth rather than replace it, and
the win is smaller than it looks. Do these last, or not at all.

- **`crash.wav`** — 1–2 s. *A car hitting concrete hard: metal crumpling,
  plastic cracking and skittering, glass fragments scattering across the
  ground. Dry, close, no reverb, no music.*

- **`tear.wav`** — 0.5–1 s. *A car door being ripped off its hinges at speed:
  a sharp metallic shriek and snap followed by the panel tumbling away.*

- **`prop.wav`** — 0.5 s. *A plastic traffic cone struck at speed and sent
  spinning across concrete. Hollow, light, scuffing.*

### 2.5 UI — not needed

The menu tones are square-wave blips and they are consistent with the HUD's
whole language. A sampled UI kit would sit oddly against a synthesised car.
Leaving them.

---

## 3. What happens when the files land

Nothing loads audio files today — the whole point of the current design was
"no files, no licensing, no loading". So the first drop needs:

1. A loader with a **manifest and graceful degradation**: any file that is
   missing or fails to decode falls back to the synth voice that is there now.
   The game must never fail to boot because an asset 404s.
2. `_buildMusic()` swapped from the saw pad to a buffer source behind the same
   `mix.music * duck` gain — the seam already exists, this is a small change.
3. Exact **loop points** set from the BPM and bar count you give me, rather
   than relying on file boundaries.
4. Per-arena room tone selected the same way the PA already is
   (`pa.setArena(id)` exists).
5. `MUSIC_GAIN` retuned — it is currently 0.055, which is right for a raw saw
   pad and far too low for a mastered track.
6. A budget check. `public/` is already 24 MB of capture clips; the audio set
   should land near 8–12 MB compressed, and I will report the real number.

Give me one file — any one — and I will build the loader around it so you can
hear the next one the moment you drop it in.
