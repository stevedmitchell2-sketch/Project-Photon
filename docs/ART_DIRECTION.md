# Photon Art Direction

The permanent artistic foundation. [VISUAL_STYLE_GUIDE.md](./VISUAL_STYLE_GUIDE.md) is the working
rulebook — palettes, readability rules, the venue language, what to do when two systems want the
same fixture. This document is the layer above it: *why* those rules exist, and what should govern
decisions the rulebook does not yet cover.

When they disagree, this document wins and the style guide should be corrected.

---

## 1. What Photon is

**A professional televised laser sport, roughly twenty years from now.**

That single sentence settles most arguments. It is not a military shooter, not a cyberpunk street,
not an abandoned station. It is a *sport*, played in a *venue*, for an *audience*.

Three consequences follow, and almost every visual decision in the project is downstream of one of
them:

1. **Everything is maintained.** No rust, no grime, no decay, no scorch marks that were not made in
   the last five minutes. Wear says "abandoned", and abandoned is a different genre with a different
   emotional register. Photon's surfaces are clean because someone cleans them.
2. **Everything is specified.** Lights exist because a lighting designer placed them. Signage exists
   because someone needed to find their way. Cover exists because the sport requires it. Nothing is
   set dressing that a real facility would not have paid for.
3. **The building is instrumentation.** The arena reports the state of the match — territory colour,
   objective control, the clock, the score, the eliminations. This is Photon's strongest identity
   lever and the one thing that most separates it from a generic sci-fi arena. A venue that did not
   tell you the score would be a badly designed venue.

### What Photon is not

Recorded so they are not re-proposed:

- **Not grimy.** See above.
- **Not dark.** Contrast comes from lit-versus-unlit regions, not from a global dim. A dark arena is
  a broadcast failure.
- **Not rainbow.** Two team colours plus house cyan. Every additional hue dilutes the one channel
  that carries meaning.
- **Not busy.** Ambient motion is slow and peripheral. The fastest thing on screen is always a
  player or a bolt.
- **Not realistic at readability's expense.** A photoreal dark metal would be physically correct and
  would make a player standing in front of it invisible. Readability wins, every time.

## 2. Colour

Colour in Photon is **information first and decoration never**.

### Reserved channel

| Role | Hex | Meaning |
| --- | --- | --- |
| Red team | `#ff2d55` | This belongs to red |
| Blue team | `#2d7bff` | This belongs to blue |
| Green / Gold | `#2dff87` / `#ffc93d` | Third and fourth teams |
| Photon cyan | `#2de0ff` | The house. Neutral, unclaimed, UI chrome |

**A decorative object may never be a team colour.** A red sponsor board reads as red territory to a
player scanning a room for an enemy, and that is a gameplay cost paid for a decorative gain.

### The body of the world

Mid-dark desaturated blue-greys: floors `#2b3340`, walls `#353f4d`, up through pillars at `#455161`.
These sit deliberately above near-black. Bloom and neon need something to sit *against*; with base
surfaces near `#141414` there is no tonal separation left after tone mapping and the arena reads as
a black screen with glowing lines. That was a real failure mode in M1.

### Accent

Amber `#ffc93d` for advisory, directional and sponsor signage — the one non-team accent, chosen
because it is unmistakably not a team colour at a glance.

## 3. Architecture language

**Panelled, layered, and legibly constructed.** A Photon surface should look assembled rather than
extruded.

- **Seams give scale.** A featureless floor gives the eye no size reference, which is most of what
  makes a graybox look like a graybox. Competition flooring is laid in panels with visible seams for
  exactly this reason.
- **Steps and chamfers give silhouette.** Two volumes of slightly different width read as designed;
  one slab reads as placeholder. The rifle's upper shroud is narrower than its receiver on purpose.
- **Structure is exposed where it is load-bearing.** Ribs, trusses and frames are visible. This is
  sports architecture, which shows its engineering.
- **Hexagons are the one geometric flourish.** They read as engineered rather than ornamental, tile
  without a visible grid direction, and give Photon a recognisable motif. Used sparingly — a hex
  floor everywhere is noise.

## 4. Material library

Materials are **named physical substances**, not colours. `brushedAluminium` is a substance; "the
wall material" is not, because a wall might be aluminium or composite depending on what the arena
says it is. Colour is supplied by the caller.

| Substance | Where |
| --- | --- |
| `brushedAluminium` | Structural metal, pillars, weapon frame |
| `titanium` | Ribs, trusses, heat fins |
| `carbonFibre` | Cover, barriers, weapon shell — engineered composite, not armour |
| `compositePolymer` | The bulk of walls; deliberately unremarkable |
| `rubberGrip` | Grips and pads — reads as "hand goes here" |
| `antiSlipFloor` | Walkways, ramps, catwalks |
| `competitionFloor` | The playing surface |
| `hexPanel` | The signature motif |
| `temperedGlass` | Observation glazing |
| `energyGlass` | Barriers, gates, shield emitters |
| `ledStrip` | Guidance and trim lighting |
| `holoPanel` | Display faces |
| `paintedAlloy` | Furniture, housings, brackets |
| `energyEmitter` | Emitter tips, charge cells, weapon core |

### Three rules that were learned the hard way

1. **Roughness maps multiply.** Three.js multiplies the map into the material's `roughness`; it does
   not replace it. Textures drawn at mid-grey *halve* roughness — the first library version turned
   every wall into semi-polished plastic and washed the scene out. Textures live in the 0.7–1.0 band
   and modulate downward.
2. **The arena is lit for a specific material response.** Metalness and roughness are close to the
   values the lighting was tuned against. A pass using physically nicer numbers cost the scene its
   contrast. Texture variation was the win; the response was already right.
3. **Emissive is not scale-invariant.** What matters is the solid angle a surface occupies. A value
   tuned on a wall 10 m away reads as a glowing slab on a view model 0.4 m from the near plane. The
   library scales weapon-scale substances to roughly a fifth.

## 5. Lighting philosophy

**The arena lights itself. The renderer does not light it.**

- Ambient is a *floor*, not a source. It is global and cannot be masked per room, so a generous
  ambient makes an unlit space impossible.
- One shadow-casting light. Shadow maps are the most expensive light feature by far.
- Light intensity is physical — illuminance falls as `intensity / d²`. A ceiling fixture 7 m up needs
  intensity in the hundreds.
- **Express colour with emissive geometry, not with lights.** The frame is fragment-bound: eight
  dynamic lights cost 2.3 ms of a 12.3 ms frame. Team territory was built from unlit emissive and
  cost 0.59 ms; built from lights it would have cost more than the whole post chain. Add a real
  light only when the colour must *fall on other surfaces* to be legible.

## 6. Weapon design language

The PH-6 Photon Rifle is the reference.

- **Sports equipment, not a weapon.** No magazine, no camouflage, no armour plating. The parts that
  do the work are on show, the way a track bike or a racing shell shows its structure.
- **An exposed energy spine** running the length of the body is the signature. It is what makes a
  Photon weapon identifiable in a screenshot.
- **The weapon reports its own state.** Charging rails carry a travelling band while the cell
  recharges and idle as a slow breath when ready; the core pulses with remaining charge. A player
  should be able to read the weapon without looking away from the fight.
- **Team trim on the upper flank**, visible to other players as well as the holder.
- **Silhouette before surface.** Proportion, stance and the step between volumes matter more than
  panel-line density at first-person distance.

## 7. Character design language

- **Elite competitors, not soldiers.** Athletic armour over a suit, not military webbing.
- **Silhouette over detail.** The readable part of a player at 20 m is the outline. Helmet, vest and
  limb blockout with emissive team trim reads better than a detailed mesh.
- **Team trim on chest, shoulders, back and helmet crest** — the surfaces visible from every angle,
  so team is identifiable from behind and above as well as head-on.
- **The back-mounted energy cell is the intended silhouette signature.** Currently a trim plate; it
  is the piece most worth authoring properly first.
- **Colour is never the only carrier.** An overhead marker ring gives shape as well as hue.

## 8. Environmental storytelling

Every space should answer *why does this exist*. The arena is a working facility:

| Space | Purpose |
| --- | --- |
| Competition floor | The sport |
| Spawn sectors | Team preparation and re-entry |
| Central objective | The contested ground the mode is built around |
| Perimeter boards | Broadcast — score, clock, eliminations, control |
| Signage | Wayfinding and safety, because a real venue is regulated |

**Nothing should exist without a believable purpose.** A prop that a real facility would not have
paid for does not belong, however good it looks.

## 9. Future arenas

The pattern to follow, established in Sprints 9–10:

> **Arena data declares intent. The renderer decides expression.**

An arena file says *there is a scoreboard on this wall*, *this territory belongs to red*, *this room
reacts to the objective*. It never says what a scoreboard looks like. That is what lets every future
arena inherit the visual language for free, and what lets the language change without re-authoring
every map.

### Known requirement for Arenas 02–04

**At least one long hall or gallery.** Arena 01 stops offering sight lines beyond roughly 10 m, which
was measured, not guessed: bots preferring 15 m and 19 m converged on the same achieved range, and
the difficulty ladder collapsed from four tiers to two. The weapon's falloff bands from 28 m, its
ADS and its projectile lead are all unexercised as a result.

A longer arena unblocks the difficulty ladder, the weapon's ranged design, and the visual drama of
depth all at once.

## 10. Rhythm versus silhouette

The rule that decides whether something should be generated or modelled, and the correction to a
conclusion Sprint 11 drew too broadly:

> **If the detail is a rhythm, generate it. If it is a silhouette, model it.**

Sprint 11 concluded that procedural geometry had hit its ceiling. That is true of *hero assets* —
a rifle, a character — where what is missing is surface density: bevels, panel gaps, edge wear,
cable runs, moulded detail. No amount of procedural cleverness substitutes for an artist there.

It is **not** true of architecture. Sprint 13 built the arena's wall articulation, broadcast rig and
cover detailing entirely in code: 474 elements on a regular bay rhythm, derived from the existing
brush dimensions, costing 1.22 ms and 17 draw calls. A person would have to place four hundred of
those by hand and keep them aligned, and would get it wrong.

Practically:

| Generate | Model |
| --- | --- |
| Wall bays, ribs, panel rhythm | Weapons |
| Trim channels and lit strips | Characters |
| Truss grids, fixture arrays | Hero props with a distinctive shape |
| Cover caps, posts, banding | Anything the player looks at closely |
| Floor markings, lane lines | Anything asymmetric or organic |
| Anything derived from level data | Anything whose value is its outline |

The dividing question is: **does this repeat on a rule?** If yes, a generator will place it better
and consistently, and it will keep working for every future arena for free.

## 11. The honest limit of procedural art

Everything in Photon is generated from code — geometry from primitives, textures from canvas
drawing, materials from parameters. That has taken the project a long way and it has a ceiling, which
this sprint reached.

**What code does well here:** proportion, silhouette, material response, animation, colour
discipline, and anything that must respond to game state. The rifle's charging rails and the arena's
reactive lighting are genuinely good and would not be improved by an imported asset.

**What code does badly:** surface density. Bevels, panel gaps, wear at edges, stickers, cable runs,
moulded detail — the small-scale texture that separates "well-proportioned primitives" from
"a modelled object". No amount of procedural cleverness substitutes for an artist's pass.

**The next leap is an asset pipeline**, not more generated geometry: a modular environment kit and a
hero weapon authored in a DCC tool, imported as glTF. The architecture is already prepared for it —
the rifle's animation is written against part references, avatars are instanced by (geometry,
material), and the material library is keyed by substance. An imported mesh replaces geometry
without touching the systems that drive it.

That is a scoping judgement, recorded here so it is not rediscovered — but read it alongside
section 10. The limit is real for hero assets and does *not* apply to rule-based architecture, which
is where Sprint 13 found most of the remaining visual gain.
