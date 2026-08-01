# Modular Environment Kit

The specification every future Photon arena is assembled from.

---

## The grid

**4 metres.** Every structural module is 4 m or a clean fraction of it, and every module's origin is
at its **bottom-centre on the grid**.

Everything follows from that:

| Dimension | Value | Why |
| --- | --- | --- |
| Grid | 4 m | Two player widths plus cover clearance |
| Wall height | 4 m | One grid unit. Upper deck sits at 5 m in Arena 01, so a wall plus trim reaches it |
| Floor tile | 4 × 4 m | One grid cell |
| Door width | 2 m | Half a cell — two players abreast, which is the flanking unit |
| Catwalk width | 2 m | Half a cell |
| Cover height | 1.1 m | Chest-high at 1.8 m standing; crouch (1.15 m) clears it |

A 4 m grid with a 1.8 m character means a room is legible in player-widths, which is what makes an
arena readable without a minimap.

## Snapping

- **Origin at bottom-centre**, on the grid intersection.
- **Modules meet flush.** No overlap, no gap. A wall panel occupies exactly 4 m of grid edge.
- **Seams belong on grid lines**, so tiling never produces a visible half-panel.
- **No baked ambient occlusion at module edges** — it produces dark seams where modules meet, which
  is the single most common way a modular kit reads as tiled.

## Structural kit

The vocabulary an arena's shell is built from.

| Module | Size | Notes |
| --- | --- | --- |
| `WallPanelLarge` | 4 × 4 m | The default surface. Recessed trim channel for LED strips |
| `WallPanelWindow` | 4 × 4 m | Observation glazing. `MAT_glass` zone |
| `WallPanelService` | 4 × 4 m | Access hatch, conduit, maintenance labelling |
| `WallCorner` | 4 × 4 m | Inside and outside variants |
| `FloorCompetition` | 4 × 4 m | The playing surface |
| `FloorMaintenance` | 4 × 4 m | Access panels, seams |
| `FloorGlass` | 4 × 4 m | Observation panel |
| `CeilingPanel` | 4 × 4 m | Plain, with vent variants |
| `CeilingLightRig` | 4 × 4 m | Suspended truss with integrated fixtures |
| `CatwalkStraight` | 4 × 2 m | Anti-slip decking |
| `CatwalkCorner` | 2 × 2 m | |
| `RampStandard` | 4 × 2 m | Rises 2 m over 4 m — matches `MOVEMENT.maxSlopeAngle` |
| `StairFlight` | 4 × 2 m | Rises 2 m. Steps ≤ `MOVEMENT.stepHeight` |
| `RailingStraight` | 4 m | `noNav`, so bots path past it correctly |
| `RailingCorner` | 2 m | |

**Ramp and stair rise are gameplay constraints, not art choices.** A ramp steeper than
`maxSlopeAngle` is unwalkable; a stair step taller than `stepHeight` stops the character controller.
Both come from `config/movement.ts` and neither is negotiable.

## Arena kit

Modules that carry gameplay meaning.

| Module | Size | Notes |
| --- | --- | --- |
| `CoverBarrier` | 2 × 1.1 m | Chest-high. The most-used object in the game |
| `CoverPillar` | 1 × 4 m | Full-height, breaks sight lines |
| `CoverLow` | 2 × 0.6 m | Crouch-only cover |
| `SpawnPad` | 4 × 4 m | Team-coloured floor plate. `TEAM_` zone |
| `ObjectivePlatform` | 8 × 8 m | The contested ground |
| `ScoreboardMount` | 4 × 2 m | Bracket for a display board |
| `BroadcastTower` | 2 × 6 m | Camera rig |
| `EnergyBarrier` | 4 × 3 m | `energyGlass`. Thin surface — highest overdraw substance |

## Prop kit

Set dressing with a stated purpose. Nothing here exists that a real facility would not have paid for.

| Prop | Purpose |
| --- | --- |
| `PowerGenerator` | Where the arena's energy comes from |
| `ChargingStation` | Where players recharge between rounds |
| `EquipmentLocker` | Where kit is stored |
| `MaintenanceRobot` | Who maintains the venue |
| `VentilationUnit` | Air handling |
| `ServerRack` | Match systems, scoring, broadcast |
| `ControlConsole` | Where officials sit |
| `SupplyCrate` | Logistics |
| `LightFixture` | Installed lighting |
| `HologramEmitter` | Projector for floating displays |

## Budgets

| | Modules | Props |
| --- | --- | --- |
| Triangles | 2,500 | 4,000 |
| Material zones | **2** | 3 |
| Texture | 1024px | 1024px |
| LODs | 2, LOD1 ≤50% | 2 |

**Two material zones per module is the tightest budget in the project, and it is the most important
one.** Modules are placed hundreds of times. A kit that shares one material set across every module
collapses an entire arena into a handful of draw calls; a kit where each module brings its own
materials produces hundreds.

This is what **trim sheets** are for: one texture serving the whole kit, with each module's UVs
laid into the regions it needs. Not yet authored — it is the largest remaining efficiency win once
real assets exist.

## How an arena consumes the kit

The architectural rule established in Sprints 9–10 holds:

> **Arena data declares intent. The renderer decides expression.**

An arena file says *there is a wall here* and *this territory belongs to red*. It never says what a
wall looks like. That is what lets every future arena inherit the visual language for free, and lets
the language change without re-authoring every map.

Today `MapBuilder` builds brushes from primitives. The module path adds a second source — a brush
kind may resolve to a kit module instead of a box — and the two coexist, so an arena can be migrated
module by module rather than in one rewrite.

## The sight-line requirement

**At least one future arena must include a long hall or gallery.**

Measured in Sprint 10: Arena 01 stops offering sight lines beyond roughly 10 m. Bots preferring 15 m
and 19 m converged on the same achieved range, and the difficulty ladder collapsed from four tiers to
two. The weapon's falloff bands from 28 m, its ADS and its projectile lead are all unexercised.

This is a measured constraint on arena *design*, not a preference, and it should shape Arenas 02–04
before they are authored.

## Checklist

- [ ] Origin at bottom-centre on the grid
- [ ] Dimensions are 4 m or a clean fraction
- [ ] Meets neighbours flush, seams on grid lines
- [ ] No baked AO at edges
- [ ] Ramps within `maxSlopeAngle`, stairs within `stepHeight`
- [ ] Railings marked for `noNav`
- [ ] ≤2 material zones (modules) or ≤3 (props)
- [ ] `COL_` collision, convex and coarse
- [ ] Two LODs
- [ ] `npm run asset-audit` passes
