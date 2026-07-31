import { applyDeadzone, clamp, DEG2RAD, responseCurve } from '@/util/math';
import { createInputFrame, resetInputFrame, type InputFrame } from './InputFrame';
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_PAD_BINDINGS,
  type GameAction,
  type KeyBindings,
  type PadBindings,
} from './bindings';

export interface InputSettings {
  mouseSensitivity: number;
  padSensitivity: number;
  invertY: boolean;
  stickDeadzone: number;
  stickResponseCurve: number;
  /** Hold vs toggle for the stance/aim modifiers. */
  toggleSprint: boolean;
  toggleCrouch: boolean;
  toggleAds: boolean;
  rumbleEnabled: boolean;
  rumbleStrength: number;
  keyBindings: KeyBindings;
  padBindings: PadBindings;
}

export const defaultInputSettings = (): InputSettings => ({
  mouseSensitivity: 0.9,
  padSensitivity: 2.6,
  invertY: false,
  stickDeadzone: 0.14,
  stickResponseCurve: 1.7,
  toggleSprint: false,
  toggleCrouch: false,
  toggleAds: false,
  rumbleEnabled: true,
  rumbleStrength: 1,
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
  padBindings: { ...DEFAULT_PAD_BINDINGS },
});

/** Mouse counts-to-radians factor at sensitivity 1.0. Matches a ~0.022 in-game "CoD sens". */
const MOUSE_RADIANS_PER_COUNT = 0.0022;

type ActionState = { down: boolean; pressedThisTick: boolean };

/**
 * Collects raw browser input and produces one InputFrame per simulation tick.
 *
 * Mouse deltas accumulate continuously and are drained on `sample()`, so aim resolution is never
 * limited by the tick rate — a 1000 Hz mouse still contributes every count.
 */
export class InputManager {
  private readonly actions = new Map<GameAction, ActionState>();
  private mouseDX = 0;
  private mouseDY = 0;
  private padIndex: number | null = null;
  private padLean = 0;
  private readonly frame: InputFrame = createInputFrame();
  private tick = 0;
  private pointerLocked = false;
  private disposers: Array<() => void> = [];

  /** Toggle latches for toggle-style modifiers. */
  private toggles = { sprint: false, crouch: false, ads: false };

  onPauseRequested: (() => void) | null = null;
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  constructor(private settings: InputSettings) {}

  updateSettings(settings: InputSettings): void {
    this.settings = settings;
  }

  attach(target: HTMLElement): void {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = this.settings.keyBindings[e.code];
      if (!action) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.heldCodes.add(e.code);
      this.press(action);
      if (action === 'pause') this.onPauseRequested?.();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.heldCodes.delete(e.code);
      const action = this.settings.keyBindings[e.code];
      if (action) this.release(action);
    };
    const onMouseDown = (e: MouseEvent) => {
      // Mouse buttons only act while the pointer is locked.
      //
      // The click that *engages* pointer lock is itself a Mouse0 press bound to fire, so without
      // this guard entering the arena spends a shot before the player has seen the world — observed
      // as a 4/6 charge cell on a fresh spawn. The lock-acquiring click must be swallowed.
      if (!this.pointerLocked) return;
      const code = `Mouse${e.button}`;
      const action = this.settings.keyBindings[code];
      if (action) {
        e.preventDefault();
        this.heldCodes.add(code);
        this.press(action);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      const code = `Mouse${e.button}`;
      this.heldCodes.delete(code);
      const action = this.settings.keyBindings[code];
      if (action) this.release(action);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === target;
      if (!this.pointerLocked) this.releaseAll();
      this.onPointerLockChange?.(this.pointerLocked);
    };
    const onBlur = () => this.releaseAll();
    const onPadConnected = (e: Event) => {
      this.padIndex = (e as GamepadEvent).gamepad.index;
    };
    const onPadDisconnected = (e: Event) => {
      if (this.padIndex === (e as GamepadEvent).gamepad.index) this.padIndex = null;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    target.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    target.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('gamepadconnected', onPadConnected);
    window.addEventListener('gamepaddisconnected', onPadDisconnected);

    this.disposers = [
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => target.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => target.removeEventListener('contextmenu', onContextMenu),
      () => document.removeEventListener('pointerlockchange', onPointerLockChange),
      () => window.removeEventListener('blur', onBlur),
      () => window.removeEventListener('gamepadconnected', onPadConnected),
      () => window.removeEventListener('gamepaddisconnected', onPadDisconnected),
    ];
  }

  detach(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.releaseAll();
  }

  requestPointerLock(target: HTMLElement): void {
    if (document.pointerLockElement !== target) void target.requestPointerLock();
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  private state(action: GameAction): ActionState {
    let s = this.actions.get(action);
    if (!s) {
      s = { down: false, pressedThisTick: false };
      this.actions.set(action, s);
    }
    return s;
  }

  private press(action: GameAction): void {
    const s = this.state(action);
    if (!s.down) s.pressedThisTick = true;
    s.down = true;
    if (action === 'sprint' && this.settings.toggleSprint) this.toggles.sprint = !this.toggles.sprint;
    if (action === 'crouch' && this.settings.toggleCrouch) this.toggles.crouch = !this.toggles.crouch;
    if (action === 'ads' && this.settings.toggleAds) this.toggles.ads = !this.toggles.ads;
  }

  private release(action: GameAction): void {
    this.state(action).down = false;
  }

  private releaseAll(): void {
    for (const s of this.actions.values()) s.down = false;
    this.heldCodes.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  private down(action: GameAction): boolean {
    return this.actions.get(action)?.down ?? false;
  }

  /** Reads gamepad axes/buttons; called at the start of every sample. */
  private pollGamepad(): { moveX: number; moveZ: number; lookX: number; lookY: number } {
    const result = { moveX: 0, moveZ: 0, lookX: 0, lookY: 0 };
    if (typeof navigator.getGamepads !== 'function') return result;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = this.padIndex !== null ? pads[this.padIndex] : null;
    if (!pad) {
      pad = pads.find((p): p is Gamepad => p !== null && p.connected) ?? null;
      if (pad) this.padIndex = pad.index;
    }
    if (!pad) return result;

    const dz = this.settings.stickDeadzone;
    const [lx, ly] = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, dz);
    const [rx, ry] = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, dz);
    result.moveX = lx;
    result.moveZ = -ly;
    result.lookX = responseCurve(rx, this.settings.stickResponseCurve);
    result.lookY = responseCurve(ry, this.settings.stickResponseCurve);

    this.padLean = 0;
    for (const [indexStr, action] of Object.entries(this.settings.padBindings)) {
      const index = Number(indexStr);
      const button = pad.buttons[index];
      if (!button) continue;
      // Triggers are analog; treat past-half as pressed.
      const isDown = button.pressed || button.value > 0.5;
      const s = this.state(action);
      if (isDown && !s.down) {
        s.pressedThisTick = true;
        if (action === 'pause') this.onPauseRequested?.();
      }
      // Keyboard and pad share the action state; only let the pad set it, never clear a held key.
      if (isDown) s.down = true;
      else if (!this.keyboardHolds(action)) s.down = false;
      if (isDown && action === 'lean_left') this.padLean -= 1;
      if (isDown && action === 'lean_right') this.padLean += 1;
    }
    return result;
  }

  /** True when a currently-held keyboard/mouse code maps to this action. */
  private keyboardHolds(action: GameAction): boolean {
    return this.heldCodes.size > 0 && [...this.heldCodes].some((c) => this.settings.keyBindings[c] === action);
  }

  private heldCodes = new Set<string>();

  /** Produces the frame for this simulation tick and clears per-tick edges. */
  sample(dt: number): InputFrame {
    const f = resetInputFrame(this.frame);
    const pad = this.pollGamepad();

    let moveX = (this.down('move_right') ? 1 : 0) - (this.down('move_left') ? 1 : 0);
    let moveZ = (this.down('move_forward') ? 1 : 0) - (this.down('move_back') ? 1 : 0);
    moveX += pad.moveX;
    moveZ += pad.moveZ;
    const mag = Math.hypot(moveX, moveZ);
    if (mag > 1) {
      moveX /= mag;
      moveZ /= mag;
    }
    f.moveX = moveX;
    f.moveZ = moveZ;

    // Mouse: raw counts, sensitivity applied once, drained so nothing is lost between ticks.
    const mouseScale = MOUSE_RADIANS_PER_COUNT * this.settings.mouseSensitivity;
    let yaw = -this.mouseDX * mouseScale;
    let pitch = -this.mouseDY * mouseScale;
    this.mouseDX = 0;
    this.mouseDY = 0;

    // Stick: rate-based, so it scales with tick length rather than sample count.
    const padScale = this.settings.padSensitivity * dt;
    yaw += -pad.lookX * padScale;
    pitch += -pad.lookY * padScale;

    if (this.settings.invertY) pitch = -pitch;
    f.lookYaw = yaw;
    f.lookPitch = pitch;

    const leanKeys = (this.down('lean_right') ? 1 : 0) - (this.down('lean_left') ? 1 : 0);
    f.lean = clamp(leanKeys + this.padLean, -1, 1);

    f.jump = this.down('jump');
    f.sprint = this.settings.toggleSprint ? this.toggles.sprint : this.down('sprint');
    f.crouch = this.settings.toggleCrouch ? this.toggles.crouch : this.down('crouch');
    f.fire = this.down('fire');
    f.ads = this.settings.toggleAds ? this.toggles.ads : this.down('ads');
    f.reload = this.down('reload');
    f.interact = this.down('interact');

    f.jumpPressed = this.consumePress('jump');
    f.crouchPressed = this.consumePress('crouch');
    f.firePressed = this.consumePress('fire');
    f.reloadPressed = this.consumePress('reload');
    f.interactPressed = this.consumePress('interact');

    // Clear any remaining edges so an unpolled action never fires late.
    for (const s of this.actions.values()) s.pressedThisTick = false;

    f.tick = this.tick++;
    return f;
  }

  private consumePress(action: GameAction): boolean {
    const s = this.actions.get(action);
    if (!s || !s.pressedThisTick) return false;
    s.pressedThisTick = false;
    return true;
  }

  /** True while the scoreboard key is held — read directly by the HUD, not part of the sim. */
  get scoreboardHeld(): boolean {
    return this.down('scoreboard');
  }

  /** Dual-rumble on the active pad, respecting the accessibility strength slider. */
  rumble(strong: number, weak: number, durationMs: number): void {
    if (!this.settings.rumbleEnabled || this.padIndex === null) return;
    const pads = navigator.getGamepads?.();
    const pad = pads?.[this.padIndex];
    const actuator = (pad as Gamepad & { vibrationActuator?: GamepadHapticActuator })?.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') return;
    const s = this.settings.rumbleStrength;
    void actuator
      .playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: clamp(strong * s, 0, 1),
        weakMagnitude: clamp(weak * s, 0, 1),
      })
      .catch(() => {
        /* Some browsers reject when the pad is mid-effect; dropping the frame is correct. */
      });
  }

  /** Converts a look delta into degrees for HUD sensitivity previews. */
  static radiansToDegrees(v: number): number {
    return v / DEG2RAD;
  }
}
