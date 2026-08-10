/**
 * Dev capture harness for the arena visual work.
 *
 * Served by the Vite dev server straight off disk (`/tools/capture/harness.js`) and never imported
 * by application code, so it does not enter the production bundle. It exists because before/after
 * comparisons are worthless unless both arms use the *same* camera, and the six viewpoints had been
 * living in throwaway console snippets — re-typed each session, and quietly different every time.
 *
 * Usage from the page:
 *   const h = await import('/tools/capture/harness.js'); await h.install(); await h.shootAll('base');
 */

/** The six established arena viewpoints. Pinned poses, so they are reproducible to the millimetre. */
export const VIEWPOINTS = [
  { id: '01_close_wall', x: 0, y: 0.06, z: 18, yaw: 0, pitch: -0.02 },
  { id: '02_gameplay_mid', x: 0, y: 0.06, z: 12, yaw: 0, pitch: -0.03 },
  { id: '03_long_sightline', x: 0, y: 0.06, z: 19, yaw: 0, pitch: 0.0 },
  { id: '04_central_overview', x: 6.5, y: 0.06, z: 6.5, yaw: -0.78, pitch: -0.06 },
  { id: '05_upper_gallery', x: 0, y: 7.4, z: 15, yaw: 0, pitch: -0.22 },
  { id: '06_spawn_area', x: 9, y: 0.06, z: 9, yaw: -2.35, pitch: -0.03 },
];

const raf = () => new Promise((r) => requestAnimationFrame(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function install() {
  const h = window.__PHOTON__;
  if (!h?.match) throw new Error('no live match — enter the arena first');
  const THREE = await import('three');
  const me = [...h.match.state.actors.values()].find((a) => a.kind === 'local');
  if (!me) throw new Error('no local actor');

  const st = h.settings.getState();
  st.setAccessibility({ ...st.accessibility, reduceViewBob: true, reduceCameraShake: true });
  try {
    h.updateSettings(h.input.settings, true, true);
  } catch {
    /* settings shape varies by build; the accessibility write above is the one that matters */
  }

  const pose = { x: 0, y: 0.06, z: 18, yaw: 0, pitch: -0.02 };
  const state = { on: true };
  if (window.__harness) window.__harness.state.on = false;

  // Pinned inside requestAnimationFrame. A setInterval pin runs out of phase with the 16.6 ms render
  // clock and produced metre-scale "drift" the last time this was tried.
  const pin = () => {
    if (!state.on) return;
    me.position.x = pose.x; me.position.y = pose.y; me.position.z = pose.z;
    me.prevPosition.x = pose.x; me.prevPosition.y = pose.y; me.prevPosition.z = pose.z;
    me.yaw = pose.yaw; me.prevYaw = pose.yaw;
    me.pitch = pose.pitch; me.prevPitch = pose.pitch;
    me.velocity.x = 0; me.velocity.y = 0; me.velocity.z = 0;
    me.health = 100; me.alive = true; me.spawnProtection = 99999;
    requestAnimationFrame(pin);
  };
  requestAnimationFrame(pin);

  const read = () => [h.view.position.x, h.view.position.y, h.view.position.z, h.view.yaw, h.view.pitch];

  /** Waits for the view to actually stop moving rather than guessing a delay. */
  const settle = async () => {
    let last = read(), still = 0, n = 0;
    while (n++ < 300) {
      await raf();
      const cur = read();
      const d = Math.max(...cur.map((v, i) => Math.abs(v - last[i])));
      last = cur;
      still = d < 0.0008 ? still + 1 : 0;
      if (still >= 10) return true;
    }
    return false;
  };

  const stats = () => {
    const s = h.renderStats;
    return {
      gpuMs: +s.gpuMs.toFixed(2), cpuMs: +s.cpuMs.toFixed(2),
      draws: s.drawCalls, programs: s.programs, tris: s.triangles,
    };
  };

  const api = { THREE, me, pose, state, settle, stats, h };
  window.__harness = api;

  /** Captures one viewpoint, guarded: the camera must be where we think it is. */
  api.shoot = async (vp, prefix) => {
    Object.assign(pose, { x: vp.x, y: vp.y, z: vp.z, yaw: vp.yaw, pitch: vp.pitch });
    const settled = await api.settle();
    await wait(250);
    const before = read();
    const r = await h.capture(`${prefix}${vp.id}`, 12);
    const after = read();
    const moved = Math.max(...before.map((v, i) => Math.abs(v - after[i])));
    // Assert the camera actually reached the requested pose, not merely that it held still.
    const atPose = Math.abs(before[0] - vp.x) < 0.05 && Math.abs(before[2] - vp.z) < 0.05 &&
      Math.abs(before[3] - vp.yaw) < 0.02;
    // Per-viewpoint, because draw calls and triangles are frustum-dependent: a single aggregate
    // reading taken at whichever viewpoint happened to be last compares two different scenes.
    return {
      id: vp.id, ok: r.ok && moved < 0.015 && atPose && settled,
      moved: +moved.toFixed(4), atPose, settled, perf: stats(),
    };
  };

  api.shootAll = async (prefix = '') => {
    const out = [];
    for (const vp of VIEWPOINTS) out.push(await api.shoot(vp, prefix));
    return { shots: out, allOk: out.every((s) => s.ok) };
  };
  return api;
}

export async function shootAll(prefix = '') {
  const api = window.__harness ?? (await install());
  return api.shootAll(prefix);
}
