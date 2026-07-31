/**
 * The normalized input snapshot the simulation consumes.
 *
 * Keyboard, mouse and gamepad all collapse into this one struct. Bots produce it too — a bot is
 * just an InputFrame source with a behavior tree behind it. When netcode lands, this is exactly
 * what gets serialized and sent to the server, so it deliberately contains no derived state.
 */
export interface InputFrame {
  /** Left-stick equivalent, each in [-1, 1]. moveZ is +1 forward. */
  moveX: number;
  moveZ: number;

  /** Accumulated look delta in radians for this tick (mouse + stick, sensitivity already applied). */
  lookYaw: number;
  lookPitch: number;

  /** Lean axis: -1 fully left, +1 fully right. */
  lean: number;

  jump: boolean;
  jumpPressed: boolean;
  sprint: boolean;
  crouch: boolean;
  crouchPressed: boolean;
  fire: boolean;
  firePressed: boolean;
  ads: boolean;
  reload: boolean;
  reloadPressed: boolean;
  interact: boolean;
  interactPressed: boolean;

  /** Monotonic tick index — the sequence number the server acknowledges. */
  tick: number;
}

export const createInputFrame = (): InputFrame => ({
  moveX: 0,
  moveZ: 0,
  lookYaw: 0,
  lookPitch: 0,
  lean: 0,
  jump: false,
  jumpPressed: false,
  sprint: false,
  crouch: false,
  crouchPressed: false,
  fire: false,
  firePressed: false,
  ads: false,
  reload: false,
  reloadPressed: false,
  interact: false,
  interactPressed: false,
  tick: 0,
});

export const resetInputFrame = (f: InputFrame): InputFrame => {
  f.moveX = 0;
  f.moveZ = 0;
  f.lookYaw = 0;
  f.lookPitch = 0;
  f.lean = 0;
  f.jump = false;
  f.jumpPressed = false;
  f.sprint = false;
  f.crouch = false;
  f.crouchPressed = false;
  f.fire = false;
  f.firePressed = false;
  f.ads = false;
  f.reload = false;
  f.reloadPressed = false;
  f.interact = false;
  f.interactPressed = false;
  return f;
};

export const copyInputFrame = (dst: InputFrame, src: InputFrame): InputFrame => {
  dst.moveX = src.moveX;
  dst.moveZ = src.moveZ;
  dst.lookYaw = src.lookYaw;
  dst.lookPitch = src.lookPitch;
  dst.lean = src.lean;
  dst.jump = src.jump;
  dst.jumpPressed = src.jumpPressed;
  dst.sprint = src.sprint;
  dst.crouch = src.crouch;
  dst.crouchPressed = src.crouchPressed;
  dst.fire = src.fire;
  dst.firePressed = src.firePressed;
  dst.ads = src.ads;
  dst.reload = src.reload;
  dst.reloadPressed = src.reloadPressed;
  dst.interact = src.interact;
  dst.interactPressed = src.interactPressed;
  dst.tick = src.tick;
  return dst;
};
