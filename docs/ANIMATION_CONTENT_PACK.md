# ANIMATION CONTENT PACK — Photon Arena Service Unit

**Asset:** `hero_robot` · `PhotonServiceUnit_v01.glb` · 49-joint Mixamo humanoid
**Verify with:** `npm run clip-plan` · locked by `tests/unit/clipCoverage.test.ts`
**Status:** plan verified, manifest updated, state mapper wired, **content not yet downloaded**

---

## The download list

Names are **Mixamo's, verbatim**. That matters more than it looks: the FBX exporter
writes the clip name into the file, and the engine matches on it. A name one
character off produces a state that never resolves — and that failure is silent,
because an unresolved state means the animator simply never switches and the
character keeps playing whatever it already was. Nothing looks broken.

All twelve were checked against the live resolver before this list was written.

| Mixamo clip | → state | Resolves via | Why this clip |
|---|---|---|---|
| **Breathing Idle** | `idle` | candidates | `Idle` alone is a fidget cycle — reads as impatient on a service unit |
| **Walking** | `walk` | candidates | Straight forward walk |
| **Running** | `run` | candidates | Standard run; Photon switches above 0.35 m/s |
| **Fast Run** | `sprint` | **manifest alias** | Longer stride for the >6 m/s band |
| **Crouch Idle** | `crouch` | candidates | Photon crouch is a stance, not a movement |
| **Running Slide** | `slide` | candidates | Photon has a real slide stance |
| **Jumping Up** | `jump` | candidates | Launch only — `Jump` bundles a landing that would fight the fall state |
| **Falling Idle** | `fall` | candidates | Airborne loop |
| **Hard Landing** | `landing` | **manifest alias** | Impact absorb |
| **Left Turn** | `turning` | **manifest alias** | Turn in place; mirror at runtime for right |
| **Button Pushing** | `interact` | **manifest alias** | The service animation |
| **Falling Back Death** | `death` | candidates | Deactivation — a unit powering down, not a person dying |

**Export settings** (same for every clip):

- Format **FBX Binary (.fbx)**, *Without Skin* — the rig is already bound
- **30 fps**, **no keyframe reduction**
- **In Place: ON.** Root motion is stripped on import anyway, but exporting in place
  keeps the clip honest about what it is.

Then merge into the `.blend` alongside the existing rig and re-export with
`tools/blender/photon_export.py`. Do not re-rig: these bind to the 49-joint skeleton
already in the file.

---

## Choosing for a service robot, not a soldier

Mixamo's library leans heavily military and the brief rules that out twice. Every
pick above is the neutral option: `Button Pushing` rather than a reload, `Falling
Back Death` rather than a gunshot death, plain `Walking` rather than a combat
advance. Nothing tactical, nothing aggressive.

`Button Pushing` is the one that does the most for the goal. Locomotion makes a
character *function*; a unit reaching out and operating arena equipment is what
makes it look like it has a job.

---

## What the checker found

`npm run clip-plan` rejected the first draft of this plan on four counts. Three were
missing names and one was worse.

**`Fast Run` was a collision, not a gap.** It normalises to `fast_run`, which sits
inside the **`run`** candidate list. A sprint download would have loaded perfectly
and animated the `run` state — correct-looking and wrong, with nothing to indicate
it. Pinned with an explicit alias, which beats every candidate list.

**`slide` was missing entirely.** Photon has a real slide stance and the state mapper
produces it, and the first draft had no clip for it — so a sliding player would have
fallen back to some other clip. The checker caught it by comparing the plan against
the states the renderer can actually drive.

`Hard Landing`, `Left Turn` and `Button Pushing` matched nothing, which is expected:
they are new states with no candidate lists.

---

## Manifest changes

Manifest only. No mesh, rig, material, resolver, socket or export-pipeline change.

```ts
clips: {
  idle: 'mixamo.com',        // the clip shipping today; carries no name information

  landing: 'Hard Landing',   // no candidate list — new state
  turning: 'Left Turn',      // no candidate list — new state
  interact: 'Button Pushing',// no candidate list — new state
  sprint: 'Fast Run',        // COLLISION: would otherwise serve `run`
}
```

**Eight of the twelve are deliberately absent.** Breathing Idle, Walking, Running,
Crouch Idle, Jumping Up, Falling Idle, Running Slide and Falling Back Death all
resolve on their own. An alias for a name that already matches is a second place to
keep the same fact, and the two drift. A test enforces this: any redundant alias
fails the build.

---

## Verification

`npm run clip-plan` — **12/12 resolve as named.**

Five tests in `tests/unit/clipCoverage.test.ts` fail a build on:

1. any planned clip not resolving to its intended state;
2. any clip silently claimed by a different state (the `Fast Run` class of bug);
3. any renderer-driven state with no clip in the pack;
4. a redundant alias duplicating a candidate match;
5. an alias pointing at a clip the pack does not include.

Confirmed live in-engine: the manifest loads all five aliases and normalises them
correctly (`Hard Landing` → `hard_landing`, `Fast Run` → `fast_run`, …).

---

## The state mapper (added after this pack)

All four states are now driven. The mapper moved out of `AssetAvatars.tsx` into
`src/render/CharacterStateMapper.ts`, because each of the four needs *memory* and
memory inside a `useFrame` loop is where animation bugs hide.

| State | How it is driven |
|---|---|
| `sprint` | Speed tier with a dead band centred between `walkSpeed` and `sprintSpeed` |
| `landing` | Grounded-transition edge, qualified by `airTime`, played held rather than looped |
| `turning` | Yaw rate from the actor's own `prevYaw`, with a 0.22 s hold floor |
| `interact` | `triggerInteract(actorId)` — plays a clip, carries no gameplay behaviour |

**The run threshold had to move.** The old mapper used `speed > 6 -> run`. `walkSpeed`
is 5.2, so 6 sat *above* the fastest a non-sprinting player can move: the `run` state
was unreachable without holding sprint, and normal movement played the walk clip. The
old `run` was already the sprint in all but name, which is why sprint needed the
boundary moved rather than a new one added above it.

**Coverage today is 1/10** and stays there until the files land. The single
`mixamo.com` clip serves every state through the sole-clip fallback, which is why a
standing robot currently plays a run cycle. The state *transitions* are verifiable
now; distinct visual output is not, and will not be until the twelve files are in.

---

## Sequence

1. **Download the twelve clips** with the settings above.
2. Merge into the `.blend`, re-export with `photon_export.py`.
3. `npm run asset-inspect` — expect 12 clips, rig and weights unchanged.
4. `npm run clip-plan` — expect 12/12 still resolving against the real file.
5. Confirm coverage in engine: **10/10 driven states resolving to distinct clips.** The
   mapper already reaches all of them; only the clips are missing.

Then arena presentation and environmental integration.
