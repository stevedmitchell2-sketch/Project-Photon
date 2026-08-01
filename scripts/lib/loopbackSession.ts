import { NavGraph } from '../../src/ai/NavGraph';
import { defaultMatchSettings, type MatchSettings } from '../../src/config/gameModes';
import { EventBus } from '../../src/engine/EventBus';
import { TICK_DT } from '../../src/engine/GameLoop';
import { MatchDirector } from '../../src/gameplay/MatchDirector';
import type { Actor, GameEvents } from '../../src/gameplay/types';
import { createInputFrame, type InputFrame } from '../../src/input/InputFrame';
import { buildArena, getArena } from '../../src/maps/MapBuilder';
import { NetClient } from '../../src/net/NetClient';
import { NetServer } from '../../src/net/NetServer';
import { LocalTransport } from '../../src/net/Transport';
import { initPhysics, PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type { Vec3 } from '../../src/util/math';

/**
 * In-process client/server session, for measurement rather than for play.
 *
 * `netTest.ts` drives real WebSockets against a separately-launched server, which is the right
 * shape for an end-to-end smoke test but the wrong shape for a parameter sweep: it needs a second
 * process, it cannot inject latency, and it makes the measurement depend on the loopback stack.
 * `LocalTransport` already implements the same `Transport` interface with `simulatedLatencyMs` and
 * `simulatedLossPercent` built in, so the identical session code runs with a controlled link.
 *
 * Everything here is real: a real `NetServer` with a real `MatchDirector`, real serialization, real
 * delta compression, real prediction and reconciliation. The only substitution is the wire.
 */

export interface LoopbackClientHandle {
  name: string;
  client: NetClient;
  director: MatchDirector;
  physics: PhysicsWorld;
  events: EventBus<GameEvents>;
  /** Client-side transport endpoint, so latency can be varied per client. */
  link: LocalTransport;
  tick: number;
  travelled: number;
  private_lastPos: { x: number; z: number };
}

export interface LoopbackOptions {
  settings?: Partial<MatchSettings>;
  maxClients?: number;
}

/** Scripted input for one client tick. */
export type InputPattern = (tick: number) => Partial<InputFrame>;

export class LoopbackSession {
  readonly server: NetServer;
  readonly clients: LoopbackClientHandle[] = [];
  readonly settings: MatchSettings;
  private serverDirector: MatchDirector | null = null;
  private serverPhysicsWorld: PhysicsWorld | null = null;

  constructor(options: LoopbackOptions = {}) {
    this.settings = { ...defaultMatchSettings(), ...options.settings };
    this.server = new NetServer({
      maxClients: options.maxClients ?? 16,
      settings: this.settings,
      createMatch: async () => {
        await initPhysics();
        const physics = new PhysicsWorld();
        const definition = getArena(this.settings.arena);
        buildArena(physics, definition);
        const nav = NavGraph.build(physics, definition);
        const events = new EventBus<GameEvents>();
        const director = new MatchDirector(this.settings, definition, physics, nav, events);
        director.populateBots();
        this.serverDirector = director;
        this.serverPhysicsWorld = physics;
        return { director, events };
      },
    });
  }

  /** The authoritative director. Only valid after `start()`. */
  get director(): MatchDirector {
    if (!this.serverDirector) throw new Error('session not started');
    return this.serverDirector;
  }

  async start(): Promise<void> {
    await initPhysics();
    await this.server.start();
  }

  /** Server-side visibility test, for placing a measurement scenario somewhere it can be observed. */
  hasLineOfSight(from: Vec3, to: Vec3): boolean {
    return this.serverPhysics().hasLineOfSight(from, to);
  }

  /**
   * Teleports an actor on the authoritative side.
   *
   * Legitimate because the server owns position outright: the clients are corrected onto the new
   * location within a snapshot, through the ordinary reconciliation path, exactly as they would be
   * after any other server-authored move.
   */
  placeActor(actor: Actor, position: Vec3): void {
    actor.position.x = position.x;
    actor.position.y = position.y;
    actor.position.z = position.z;
    actor.prevPosition.x = position.x;
    actor.prevPosition.y = position.y;
    actor.prevPosition.z = position.z;
    actor.velocity.x = 0;
    actor.velocity.y = 0;
    actor.velocity.z = 0;
    this.serverPhysics().setCharacterPosition(actor.bodyHandle, {
      x: position.x,
      y: position.y + actor.height * 0.5,
      z: position.z,
    });
  }

  private serverPhysics(): PhysicsWorld {
    if (!this.serverPhysicsWorld) throw new Error('session not started');
    return this.serverPhysicsWorld;
  }

  /**
   * Connects one client with its own physics world, arena and director — exactly what a browser
   * builds. `latencyMs` is applied to both directions, so the reported RTT is roughly twice it.
   */
  async addClient(
    name: string,
    team: string | null = null,
    latencyMs = 0,
    lossPercent = 0,
  ): Promise<LoopbackClientHandle> {
    const physics = new PhysicsWorld();
    const definition = getArena(this.settings.arena);
    buildArena(physics, definition);
    const nav = NavGraph.build(physics, definition);
    const events = new EventBus<GameEvents>();
    const director = new MatchDirector(this.settings, definition, physics, nav, events);
    director.createLocalPlayer(name);

    const [clientLink, serverLink] = LocalTransport.createPair();
    clientLink.simulatedLatencyMs = latencyMs;
    clientLink.simulatedLossPercent = lossPercent;
    serverLink.simulatedLatencyMs = latencyMs;
    serverLink.simulatedLossPercent = lossPercent;

    // The server endpoint is already "connected" from its side; opening the client's is what
    // starts delivery.
    await serverLink.connect();
    this.server.accept(serverLink);

    const client = new NetClient(clientLink, director, physics, events);
    await client.connect(name, team);

    const handle: LoopbackClientHandle = {
      name,
      client,
      director,
      physics,
      events,
      link: clientLink,
      tick: 0,
      travelled: 0,
      private_lastPos: { x: 0, z: 0 },
    };
    this.clients.push(handle);
    return handle;
  }

  /** Advances one client by a single tick with a scripted input. */
  stepClient(handle: LoopbackClientHandle, pattern: InputPattern): void {
    const local = handle.director.state.actors.get(handle.director.state.localActorId);
    if (!local) return;

    const frame = createInputFrame();
    Object.assign(frame, pattern(handle.tick));
    frame.tick = handle.tick;
    Object.assign(local.input, frame);

    handle.client.sendInput(local.input);
    handle.director.step(TICK_DT);
    handle.client.recordPrediction();
    handle.client.update(TICK_DT);

    const p = local.position;
    if (handle.tick > 0) {
      handle.travelled += Math.hypot(p.x - handle.private_lastPos.x, p.z - handle.private_lastPos.z);
    }
    handle.private_lastPos.x = p.x;
    handle.private_lastPos.z = p.z;
    handle.tick++;
  }

  /**
   * Runs the session for a wall-clock duration, pacing every client at 64 Hz.
   *
   * Real-time pacing is not incidental. The server runs its own `setInterval` loop and injected
   * latency is implemented with `setTimeout`, so stepping clients as fast as the loop allows would
   * both trip the server's flood protection and make the latency injection meaningless.
   */
  async run(seconds: number, patterns: InputPattern[], onTick?: (tick: number) => void): Promise<number> {
    const totalTicks = Math.round(seconds * 64);
    const startedAt = Date.now();
    let simulated = 0;

    while (simulated < totalTicks) {
      const target = Math.min(totalTicks, Math.round(((Date.now() - startedAt) / 1000) * 64));
      while (simulated < target) {
        for (let i = 0; i < this.clients.length; i++) {
          this.stepClient(this.clients[i], patterns[i % patterns.length]);
        }
        onTick?.(simulated);
        simulated++;
      }
      await sleep(2);
    }
    return (Date.now() - startedAt) / 1000;
  }

  dispose(): void {
    for (const handle of this.clients) handle.client.dispose();
    this.clients.length = 0;
    this.server.stop();
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
