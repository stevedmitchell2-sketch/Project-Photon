/** Logical actions the game understands. Bindings map physical inputs onto these. */
export type GameAction =
  | 'move_forward'
  | 'move_back'
  | 'move_left'
  | 'move_right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'slide'
  | 'lean_left'
  | 'lean_right'
  | 'fire'
  | 'ads'
  | 'reload'
  | 'interact'
  | 'scoreboard'
  | 'pause';

export interface KeyBindings {
  /** KeyboardEvent.code -> action. Mouse buttons use the pseudo-codes below. */
  [code: string]: GameAction;
}

export const MOUSE_CODE = ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'] as const;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  KeyW: 'move_forward',
  KeyS: 'move_back',
  KeyA: 'move_left',
  KeyD: 'move_right',
  ArrowUp: 'move_forward',
  ArrowDown: 'move_back',
  ArrowLeft: 'move_left',
  ArrowRight: 'move_right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  ControlLeft: 'crouch',
  KeyC: 'crouch',
  KeyQ: 'lean_left',
  KeyE: 'lean_right',
  KeyR: 'reload',
  KeyF: 'interact',
  Tab: 'scoreboard',
  Escape: 'pause',
  Mouse0: 'fire',
  Mouse2: 'ads',
};

/** Standard-gamepad button indices, per the W3C mapping. */
export type PadBindings = Record<number, GameAction>;

export const DEFAULT_PAD_BINDINGS: PadBindings = {
  0: 'jump', // A / Cross
  1: 'crouch', // B / Circle
  2: 'reload', // X / Square
  3: 'interact', // Y / Triangle
  6: 'ads', // Left trigger
  7: 'fire', // Right trigger
  10: 'sprint', // Left stick click
  8: 'scoreboard', // Back / Share
  9: 'pause', // Start / Options
  4: 'lean_left', // Left bumper
  5: 'lean_right', // Right bumper
};

export const ACTION_LABELS: Record<GameAction, string> = {
  move_forward: 'Move Forward',
  move_back: 'Move Back',
  move_left: 'Strafe Left',
  move_right: 'Strafe Right',
  jump: 'Jump / Mantle',
  sprint: 'Sprint',
  crouch: 'Crouch / Slide',
  slide: 'Slide',
  lean_left: 'Lean Left',
  lean_right: 'Lean Right',
  fire: 'Fire',
  ads: 'Aim Down Sights',
  reload: 'Vent / Recharge',
  interact: 'Interact',
  scoreboard: 'Scoreboard',
  pause: 'Pause',
};

/** Human-readable name for a physical input code. */
export const codeLabel = (code: string): string => {
  if (code.startsWith('Mouse')) {
    const idx = Number(code.slice(5));
    return ['Left Mouse', 'Middle Mouse', 'Right Mouse', 'Mouse 4', 'Mouse 5'][idx] ?? code;
  }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return `${code.slice(5)} Arrow`;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
};
