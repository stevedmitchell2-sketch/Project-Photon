/** Pure math helpers used by the simulation. No Three.js dependency — the sim must stay headless. */

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential smoothing. `halfLife` is in seconds. */
export const damp = (a: number, b: number, halfLife: number, dt: number): number => {
  if (halfLife <= 0) return b;
  return b + (a - b) * Math.pow(2, -dt / halfLife);
};

export const moveTowards = (a: number, b: number, maxDelta: number): number => {
  const d = b - a;
  if (Math.abs(d) <= maxDelta) return b;
  return a + Math.sign(d) * maxDelta;
};

/** Shortest signed angular difference in radians, result in (-PI, PI]. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
};

export const length3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const lengthSq3 = (v: Vec3): number => v.x * v.x + v.y * v.y + v.z * v.z;

export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
export const distSq3 = (a: Vec3, b: Vec3): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz;
};

export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const addScaled = (out: Vec3, v: Vec3, s: number): Vec3 => {
  out.x += v.x * s;
  out.y += v.y * s;
  out.z += v.z * s;
  return out;
};

export const copy3 = (out: Vec3, v: Vec3): Vec3 => {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
};

export const set3 = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};

export const normalize3 = (out: Vec3): Vec3 => {
  const l = length3(out);
  if (l > 1e-6) {
    out.x /= l;
    out.y /= l;
    out.z /= l;
  }
  return out;
};

/** Horizontal (XZ) speed — the quantity most movement tuning actually cares about. */
export const speedXZ = (v: Vec3): number => Math.hypot(v.x, v.z);

/**
 * Converts yaw/pitch (radians) to a unit forward vector in Three.js conventions:
 * yaw 0 looks down -Z, positive yaw turns left, positive pitch looks up.
 */
export const forwardFromLook = (yaw: number, pitch: number, out: Vec3 = vec3()): Vec3 => {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
};

/** Ground-plane basis for movement input: forward and right, both horizontal and unit length. */
export const groundBasis = (yaw: number): { fx: number; fz: number; rx: number; rz: number } => {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { fx: -s, fz: -c, rx: c, rz: -s };
};

/** Applies a radial deadzone then rescales the remainder to the full 0..1 range. */
export const applyDeadzone = (x: number, y: number, deadzone: number): [number, number] => {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return [0, 0];
  const scaled = (mag - deadzone) / (1 - deadzone);
  const inv = scaled / mag;
  return [x * inv, y * inv];
};

/** Signed exponential response curve used for stick aiming. */
export const responseCurve = (v: number, exponent: number): number =>
  Math.sign(v) * Math.pow(Math.abs(v), exponent);
