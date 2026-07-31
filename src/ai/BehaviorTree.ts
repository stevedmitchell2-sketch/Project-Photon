/**
 * Minimal, allocation-free behavior tree.
 *
 * Chosen over a state machine because bot behaviour is layered: "retreat if hurt" must be able to
 * pre-empt "fight" without either branch knowing about the other. Priority selectors express that
 * directly, and adding a behaviour later means inserting a node, not rewriting transitions.
 */

export type NodeStatus = 'success' | 'failure' | 'running';

export interface BtNode<B> {
  readonly name: string;
  tick(blackboard: B, dt: number): NodeStatus;
  /** Called when a node that was running is interrupted by a higher-priority branch. */
  abort?(blackboard: B): void;
}

/** Runs children in order, returns the first non-failure. Classic priority selector. */
export class Selector<B> implements BtNode<B> {
  private runningIndex = -1;
  constructor(
    readonly name: string,
    private readonly children: BtNode<B>[],
  ) {}

  tick(blackboard: B, dt: number): NodeStatus {
    for (let i = 0; i < this.children.length; i++) {
      const status = this.children[i].tick(blackboard, dt);
      if (status === 'failure') continue;
      // A higher-priority child taking over aborts whatever was running below it.
      if (this.runningIndex !== -1 && this.runningIndex !== i) {
        this.children[this.runningIndex].abort?.(blackboard);
      }
      this.runningIndex = status === 'running' ? i : -1;
      return status;
    }
    if (this.runningIndex !== -1) {
      this.children[this.runningIndex].abort?.(blackboard);
      this.runningIndex = -1;
    }
    return 'failure';
  }

  abort(blackboard: B): void {
    if (this.runningIndex !== -1) {
      this.children[this.runningIndex].abort?.(blackboard);
      this.runningIndex = -1;
    }
  }
}

/** Runs children in order until one fails. Resumes at the running child next tick. */
export class Sequence<B> implements BtNode<B> {
  private index = 0;
  constructor(
    readonly name: string,
    private readonly children: BtNode<B>[],
  ) {}

  tick(blackboard: B, dt: number): NodeStatus {
    while (this.index < this.children.length) {
      const status = this.children[this.index].tick(blackboard, dt);
      if (status === 'running') return 'running';
      if (status === 'failure') {
        this.index = 0;
        return 'failure';
      }
      this.index++;
    }
    this.index = 0;
    return 'success';
  }

  abort(blackboard: B): void {
    if (this.index < this.children.length) this.children[this.index].abort?.(blackboard);
    this.index = 0;
  }
}

/**
 * Sequence without memory: every child is re-evaluated from the start on each tick.
 *
 * This is what a `condition -> action` branch needs. A remembering Sequence resumes at whichever
 * child was running, which silently skips the guard on subsequent ticks — so a bot that acquired a
 * target keeps running its "fight" action long after the target died or broke line of sight.
 * Use this for guarded behaviours and the plain Sequence only for genuine multi-step plans.
 */
export class ReactiveSequence<B> implements BtNode<B> {
  private running = -1;
  constructor(
    readonly name: string,
    private readonly children: BtNode<B>[],
  ) {}

  tick(blackboard: B, dt: number): NodeStatus {
    for (let i = 0; i < this.children.length; i++) {
      const status = this.children[i].tick(blackboard, dt);
      if (status === 'success') continue;
      if (status === 'failure') {
        if (this.running !== -1 && this.running !== i) {
          this.children[this.running].abort?.(blackboard);
        }
        this.running = -1;
        return 'failure';
      }
      this.running = i;
      return 'running';
    }
    this.running = -1;
    return 'success';
  }

  abort(blackboard: B): void {
    if (this.running !== -1) {
      this.children[this.running].abort?.(blackboard);
      this.running = -1;
    }
  }
}

/** Leaf that evaluates a predicate. */
export class Condition<B> implements BtNode<B> {
  constructor(
    readonly name: string,
    private readonly predicate: (blackboard: B) => boolean,
  ) {}

  tick(blackboard: B): NodeStatus {
    return this.predicate(blackboard) ? 'success' : 'failure';
  }
}

/** Leaf that performs work and reports its own status. */
export class Action<B> implements BtNode<B> {
  constructor(
    readonly name: string,
    private readonly fn: (blackboard: B, dt: number) => NodeStatus,
    private readonly onAbort?: (blackboard: B) => void,
  ) {}

  tick(blackboard: B, dt: number): NodeStatus {
    return this.fn(blackboard, dt);
  }

  abort(blackboard: B): void {
    this.onAbort?.(blackboard);
  }
}

/** Inverts success and failure; running passes through. */
export class Inverter<B> implements BtNode<B> {
  constructor(
    readonly name: string,
    private readonly child: BtNode<B>,
  ) {}

  tick(blackboard: B, dt: number): NodeStatus {
    const status = this.child.tick(blackboard, dt);
    if (status === 'success') return 'failure';
    if (status === 'failure') return 'success';
    return 'running';
  }

  abort(blackboard: B): void {
    this.child.abort?.(blackboard);
  }
}

/** Stops a subtree from re-entering more often than `cooldown` seconds. */
export class Cooldown<B> implements BtNode<B> {
  private remaining = 0;
  constructor(
    readonly name: string,
    private readonly cooldown: number,
    private readonly child: BtNode<B>,
  ) {}

  tick(blackboard: B, dt: number): NodeStatus {
    if (this.remaining > 0) {
      this.remaining -= dt;
      return 'failure';
    }
    const status = this.child.tick(blackboard, dt);
    if (status !== 'running') this.remaining = this.cooldown;
    return status;
  }

  abort(blackboard: B): void {
    this.child.abort?.(blackboard);
  }
}
