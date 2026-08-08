# Mixamo drop folder

Put downloaded Mixamo `.fbx` files here. Nothing else in the pipeline needs your attention.

The files themselves are git-ignored — this folder is tracked so a fresh clone has somewhere to
put them.

## Download settings

Same for every clip:

- Format **FBX Binary (.fbx)**
- **Without Skin** — the rig is already bound
- **30 fps**, no keyframe reduction
- **In Place: ON** wherever the checkbox appears

## The filename is the clip name

This is the one thing that matters. Every Mixamo download contains an action called `mixamo.com`
regardless of which animation you picked, so the file's *name* is the only place the real name
exists. Leave filenames alone.

A `Character@` prefix and a ` (1)` duplicate suffix are stripped automatically. Anything else you
type in has to match Mixamo's spelling exactly, because the engine resolves animation states by clip
name and a near-miss resolves to nothing — silently. `Crouching Idle` is not `Crouch Idle`.

## The twelve clips

| Mixamo name | Photon state |
|---|---|
| Breathing Idle | `idle` |
| Walking | `walk` |
| Running | `run` |
| Fast Run | `sprint` |
| Crouching Idle | `crouch` |
| Running Slide | `slide` |
| Jumping Up | `jump` |
| Falling Idle | `fall` |
| Hard Landing | `landing` |
| Left Turn | `turning` |
| Button Pushing | `interact` |
| Falling Back Death | `death` |

Check a folder before spending time in Blender:

```bash
npm run clip-plan -- --folder assets/source/mixamo
```

That resolves each filename exactly the way the engine will, and reports anything that would land on
no state or the wrong one.
