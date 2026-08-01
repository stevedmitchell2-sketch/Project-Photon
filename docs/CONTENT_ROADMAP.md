# Photon Content Roadmap

What to make, in what order, and why.

Every item corresponds to an entry in `src/assets/manifest.ts` — the manifest *is* the
specification, and `npm run asset-audit` reports which of it exists. Read
[ASSET_STANDARDS.md](./ASSET_STANDARDS.md) before authoring anything.

---

## How items are ranked

**Impact** is what a player notices, weighted by how much of the screen and how much of the time.
It is not the same as effort, and the two are listed separately because the highest-impact item is
rarely the cheapest.

| Rating | Meaning |
| --- | --- |
| ★★★★★ | Changes the first impression of the game |
| ★★★★ | Visible in most frames |
| ★★★ | Visible often |
| ★★ | Visible in specific situations |
| ★ | Completeness |

---

## Phase 1 — Prove the pipeline, replace the most-seen things

The goal of Phase 1 is not a finished game. It is **one asset of each kind flowing end to end**, so
every remaining gap is content rather than engineering.

| # | Asset | Impact | Effort | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Hero laser rifle** | ★★★★★ | Medium | On screen 100% of the time. The pipeline is already proven against it — see the weapon section of ASSET_PIPELINE. Spec in [HERO_WEAPON_SPEC.md](./HERO_WEAPON_SPEC.md). |
| 2 | **Hero athlete** | ★★★★★ | High | Sixteen on screen at once. Needs a rig, which is the single largest piece of new engineering left. |
| 3 | **Wall panel + corner** | ★★★★ | Low | Two modules replace most of the arena's visible surface. Highest impact per hour of any item here. |
| 4 | **Competition floor tile** | ★★★★ | Low | The floor is in almost every frame and currently reads as a flat plane with seams painted on. |
| 5 | **Ceiling light rig** | ★★★ | Low | Looking up currently shows nothing. Also the arena's main light source, so it justifies its fixtures. |
| 6 | **Cover barrier** | ★★★ | Low | The object players spend the most time behind. |
| 7 | **Charging station** | ★★ | Low | Spawn-room storytelling. First prop with a stated purpose. |
| 8 | **Equipment locker** | ★★ | Low | As above. |

**Recommended order: 3, 4, 1, 5, 6, 7, 8, 2.**

Deliberately not manifest order. Items 3 and 4 are cheap, cover the most screen area, and prove the
module path before anything expensive is attempted. The rifle comes third because the pipeline is
already validated against it, so it is the lowest-risk hero asset. The character comes last in Phase 1
despite equal impact, because it needs a rig and skeletal playback that nothing else does — starting
there would block everything behind one large unknown.

## Phase 2 — A venue rather than a room

| # | Asset | Impact | Effort | Notes |
| --- | --- | --- | --- | --- |
| 9 | **Structural kit completion** | ★★★★ | Medium | Ramps, stairs, railings, catwalk decking. Completes the arena vocabulary. |
| 10 | **Broadcast assets** | ★★★ | Medium | Camera rigs, scoreboard mounts, broadcast towers. The venue's reason to exist. |
| 11 | **League branding set** | ★★★ | Low | Logos, banners, sector numbering, safety markings. Mostly decals. |
| 12 | **Animated holograms** | ★★★ | Medium | Free-floating displays. Boards are wall-mounted only today. |
| 13 | **Interactive doors** | ★★ | Medium | Powered doors exist as brushes; needs modelled panels and a collision path. |
| 14 | **Three arena kits** | ★★★★★ | Very high | Cyber Factory, Space Station, Neon Temple. **One must have long sight lines** — see below. |

### The sight-line requirement

Sprint 10 measured that **Arena 01 stops offering sight lines beyond roughly 10 m**. Bots preferring
15 m and 19 m converged on the same achieved range, and the difficulty ladder collapsed from four
tiers to two. The weapon's falloff bands from 28 m, its ADS and its projectile lead are all
unexercised as a result.

**At least one Phase 2 arena must include a long hall or gallery.** This is a measured requirement,
not a preference, and it unblocks the difficulty ladder, the weapon's ranged design and the visual
drama of depth simultaneously.

## Phase 3 — Variety

| # | Asset | Impact | Effort | Notes |
| --- | --- | --- | --- | --- |
| 15 | **Second weapon** | ★★★ | Medium | `WeaponSystem` is written around one weapon; the config is data-driven but the seams are unproven. |
| 16 | **Character variants** | ★★ | Medium | Same rig, different shells. Cheap once item 2 exists. |
| 17 | **Maintenance robots** | ★★ | Medium | Ambient life. Storytelling more than gameplay. |
| 18 | **Advanced VFX set** | ★★★ | Medium | Authored impact, energy and smoke textures replacing procedural sprites. |
| 19 | **Seasonal themes** | ★ | Low | Palette and branding swaps over existing kits. |

---

## What blocks what

```
  Wall + floor modules ──► Structural kit ──► Arena kits
                                                  ▲
  Hero rifle ──► Second weapon                    │
                                                  │
  Hero athlete ──► Character variants             │
       │                                          │
       └──► Rig + skeletal playback ──────────────┘
                    (engineering, not content)
```

**One engineering dependency remains**: skeletal animation playback. Clips are loaded and exposed by
the importer, but nothing drives them, because no rigged asset exists to test against. That work
should happen alongside item 2 rather than before it — building a playback system with nothing to
play is how you get a system that fits no real asset.

## Standing note

The manifest already contains every Phase 1 entry. Running `npm run asset-audit` on a clean checkout
reports nine specified assets, none present, and passes — because absence is the expected state and
every asset is optional.

**That report is the content backlog.** When it shows nine of nine present, Phase 1 is done.
