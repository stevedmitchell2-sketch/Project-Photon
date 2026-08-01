# Photon Visual Style Guide

The rules that make new content look like Photon rather than like generic sci-fi.

Every rule here is a conclusion from something that was built, measured, or got it wrong — not
aspiration. Where a number appears it came from a measurement, and the measurement is named so it
can be re-run and the rule overturned.

---

## 1. The one-line identity

**A working sports venue, lit by the game being played in it.**

Not a derelict station, not a military facility, not a neon cyberpunk street. The arena is
maintained, powered, and staffed by nobody — a clean, purpose-built hall whose lighting exists to
show a match to an audience. That single idea decides most questions:

- surfaces are **clean and mid-tone**, because a venue is maintained;
- light comes from **installed fixtures**, because someone specified them;
- colour means **something about the match**, because the building is instrumentation;
- there is **no grime, rust, or wear**, because those say "abandoned", which is a different game.

When a decision is ambiguous, ask what a real arena would do.

## 2. Primary palette

The saturated colours. Reserved — nothing decorative may use them.

| Role | Hex | Used for |
| --- | --- | --- |
| Red team | `#ff2d55` | Red trim, bolts, territory, HUD accent |
| Red emissive | `#ff5c78` | Bloom-facing red — brighter so it survives tone mapping |
| Blue team | `#2d7bff` | Blue trim, bolts, territory, HUD accent |
| Blue emissive | `#6d9dff` | Bloom-facing blue |
| Green team | `#2dff87` | Third team |
| Gold team | `#ffc93d` | Fourth team |
| Photon cyan | `#2de0ff` | The house colour. Neutral fixtures, unclaimed objectives, UI chrome |

**Team colour is a reserved channel.** If something is red it belongs to red, or it is a hazard.
A decorative prop may not be red, and neutral architecture may not be team-coloured — a player
scanning a room for an enemy must never be baited by a wall.

Cyan is the arena's own colour: the house, the neutral state, the UI. When the central objective is
unheld it is cyan, and when a team takes it, it becomes theirs.

## 3. Secondary palette

The unsaturated body of the world. Everything not carrying meaning lives here.

| Role | Hex |
| --- | --- |
| Floor | `#2b3340` |
| Wall | `#353f4d` |
| Catwalk | `#3f4a5b` |
| Barrier | `#3a4451` |
| Pillar | `#455161` |
| Ramp | `#3c4655` |
| Fog / background | `#0e1826` |
| Ambient bounce | `#3d5c85` |

**These sit deliberately in the mid-dark range, not near-black.** Bloom and neon need something to
sit *against*. With base surfaces around `#141414` there is no tonal separation left after ACES tone
mapping and the arena reads as a black screen with a few glowing lines. This was a real failure mode
in M1 and the palette above is the fix — see RENDERING_GUIDE.md, "Four ways to render a black
arena".

## 4. Material language

Four materials. Anything new should be recognisably one of them.

1. **Architecture** — mid-tone, low metalness, medium roughness. The building.
2. **Metal fittings** — high metalness, low roughness. Catwalks, railings, machine housings.
   **Requires an environment map**: `MeshStandardMaterial` with `metalness > 0` takes most of its
   colour from reflection, and with `scene.environment` unset it samples pure black. The PMREM
   `RoomEnvironment` in `ArenaEnvironment` is not optional.
3. **Emissive trim** — `toneMapped: false`, saturated, unlit. Strips, holograms, territory,
   objective rings. Reads at full intensity in a dark room, which is exactly what a signal should do.
4. **Glass and energy** — transparent, additive, `depthWrite: false`. Barriers, gates, beacons,
   shafts.

**Emissive is not scale-invariant.** What matters is the solid angle an object occupies, not its
material. A value tuned on a wall 10 m away is wrong on a view model 0.4 m from the near plane —
the first-person weapon needed roughly a tenth of the world-geometry value. Tune emissive at the
distance the object will actually be seen from.

## 5. Lighting philosophy

**The arena lights itself. The renderer does not light it.**

- **Ambient is a floor, not a source.** It is global and cannot be masked per room, so a generous
  ambient makes an unlit space impossible — the dark room reads exactly as bright as the lit floor.
  Keep it low and let fixtures do the work; image-based lighting carries the rest.
- **One shadow-casting light.** Shadow maps are the most expensive light feature by far. The arena
  has a single directional key; everything else is unshadowed.
- **Light intensity is physical.** Illuminance falls off as `intensity / d²`. A ceiling fixture 7 m
  above the deck needs an intensity in the hundreds. Values of 20–40 are from the pre-r155 legacy
  model and land around 0.05 — black.
- **Arena-spanning geometry must not cast shadows.** A ceiling slab will occlude the key light and
  shadow everything beneath it. Brushes carry `noShadow` for this.

### The light budget is a hard constraint, not a preference

Sprint 8 measured the frame as **fragment-bound**: taking `maxDynamicLights` from 8 to 0 was worth
**2.3 ms of a 12.3 ms frame**, because each additional light is another loop over every lit
fragment. Post-processing, shadows and the volumetric shafts together were worth about 0.1 ms.

**Therefore: express colour with emissive geometry, not with lights.** Territory identity in Sprint 9
was built from unlit emissive strips and additive beacons and cost 0.59 ms including one reactive
light. Built from eight coloured point lights it would have cost more than the entire
post-processing chain.

Add a real light only when the colour must *fall on other surfaces* to be legible.

## 6. Environmental storytelling

**The building reports the state of the match.** This is the strongest identity lever Photon has and
the one that most distinguishes it from a generic arena.

Three tiers, in increasing order of how much they say:

1. **Territory** — static team colour marking whose ground this is. Answers "where am I".
2. **Beacons** — vertical light columns readable over cover from across the room. Answers "where is
   their ground" without a HUD element.
3. **Reactive zones** — lighting that follows objective control, strobing while contested. Answers
   "what is happening right now", and is a live readout rather than decoration.

Rules:

- **Contested state strobes; it never blends.** A mix of two team colours lands on a muddy purple
  that means nothing. A strobe is unambiguous and is the language real venues already use.
- **Control changes ease, they do not cut.** `controllingTeam` flickers every time a player crosses
  a boundary; a hard cut flickers constantly. Ease over ~300 ms so only a sustained change reads.
- **Orientation furniture must never compete with combat.** Territory strips breathe slowly and sit
  at low contrast. Nothing ambient may be as bright or as fast as a muzzle flash.

## 7. Readability rules

Combat readability outranks every aesthetic consideration. In a conflict, the aesthetic loses.

- **Nothing bright and static in the centre of the screen.** Bloom at the old intensities put two
  large white-cyan blooms in the middle of the frame from most positions on the deck and washed out
  whatever was under the crosshair. Bloom intensity is now 0.35 / 0.5 / 0.68 across presets, and
  this costs nothing — measured at −0.08 ms.
- **Volumetric effects fade by view angle.** A real shaft is scattered light: strong across the view,
  weak along it. Fixed-opacity cones do the opposite and read as solid objects sitting in the room.
- **Colour is never the only carrier of meaning.** Teams have a shape as well as a hue (overhead
  marker ring, silhouette trim). The charge ring distinguishes charged from recharging by *shape* —
  discrete ticks versus a sweeping arc — not by colour alone. A colourblind palette exists and must
  keep working: every new signal needs a non-colour channel.
- **The reticle owns the centre.** A dual drop-shadow and a centre pip keep it legible against a
  bright wall. Nothing else may occupy that space.

## 8. Typography and UI

- **Rajdhani**, a squared-off technical sans, for everything. One family.
- **Uppercase, letter-spaced** for labels and callsigns; sentence case for prose.
- **Numbers are the loudest thing in the HUD.** Health, ammo and the clock are what a player reads
  mid-fight; labels beside them are small and dim.
- **Panels are dark translucent with a thin cyan rule** (`--photon-panel`, `--photon-line`). No
  fills, no gradients, no rounded corners beyond 2 px.
- **Team accent enters the HUD**, via the `--team-*` CSS variables, which mirror the simulation's
  team colours. Two sources of truth kept in step by hand — there are four and they change roughly
  never, but both places need an entry if a fifth team appears.
- **Information belongs where the eye already is.** The charge ring moved shot count from the
  bottom-right corner to the point of aim for exactly this reason.

## 9. Laser effect standards

- **Bolts are travelling projectiles, not hitscan.** They must be visible in flight — that is the
  core visual signature of the game.
- **Speed is tuned against the engagement distance, which is 7 m.** At 132 m/s a bolt took 53 ms to
  cross 7 m and needed a 45 cm lead against a strafing player — more than a body half-width, at the
  range where a laser should feel instant. At 215 m/s it is 33 ms and 27 cm, and still crosses the
  60 m arena in a quarter second, so it stays a visible streak.
- **Bolts carry team colour** at emissive brightness, so who is shooting is readable from the shot.
- **Impacts are additive and short.** Under 200 ms, every one of them. Nothing in combat lingers.

## 10. Character silhouette

- **Silhouette over detail.** The readable part of a laser tag player at range is the outline, not
  the texture. Helmet, vest, limbs — a blockout with emissive team trim reads better at 20 m than a
  detailed mesh would.
- **Team trim sits on the chest, shoulders, back and helmet crest** — the surfaces visible from
  every angle, so team is identifiable from behind and above as well as head-on.
- **Back-mounted energy cell** is the intended silhouette signature. Currently a trim plate; it is
  the piece most worth authoring properly first.
- **The rig interface is fixed.** Joint names and the pose function are the contract an authored
  character implements. Avatars are drawn instanced by (geometry, material), so a swap must preserve
  that batching — a per-player unique mesh would put draw calls back on a per-player axis.

## 11. What Photon is not

Recorded so it is not re-proposed:

- **Not grimy.** No rust, no dirt, no decay. That is a different genre.
- **Not dark.** Contrast comes from lit-versus-unlit regions, not from a global dim.
- **Not rainbow.** Team colours plus house cyan. Every additional hue dilutes the reserved channel.
- **Not busy.** Environment animation is slow and peripheral. The fastest thing on screen should
  always be a player or a bolt.

---

## Change control

A change to this document is a change to every arena that follows it. Adding a colour, a material,
or a light means updating the relevant section here first.

Performance claims in this guide are measurable and should be re-measured rather than trusted: run
the game, read CPU/GPU frame time from the HUD, and **interleave any A/B**, because GPU time is
view-dependent — the same preset has measured 8.68 ms and 12.43 ms from different vantages.
