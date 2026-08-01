import { WebSocketServer, type WebSocket } from 'ws';
import { NavGraph } from '../src/ai/NavGraph';
import { defaultMatchSettings, type MatchSettings } from '../src/config/gameModes';
import { EventBus } from '../src/engine/EventBus';
import { MatchDirector } from '../src/gameplay/MatchDirector';
import type { GameEvents } from '../src/gameplay/types';
import { buildArena, getArena } from '../src/maps/MapBuilder';
import { NetServer } from '../src/net/NetServer';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import type { Transport, TransportEvents, TransportState } from '../src/net/Transport';

/**
 * Dedicated server entry point.
 *
 * This is the payoff for the headless-simulation rule: the file below constructs physics, an arena
 * and a MatchDirector, and runs the *identical* simulation code the browser runs. Nothing in
 * `gameplay/`, `ai/`, `physics/` or `maps/` needed a single change to run under Node, because none
 * of it ever imported React or Three.js.
 *
 *   npm run server -- --port 8080 --mode team_deathmatch --max 16
 */

/** Adapts a `ws` socket to the engine's Transport interface. */
class WsTransport implements Transport {
  private handlers: { [K in keyof TransportEvents]: Set<TransportEvents[K]> } = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };
  private _state: TransportState = 'open';
  readonly rttMs = 0;

  constructor(private readonly socket: WebSocket) {
    socket.binaryType = 'arraybuffer';
    socket.on('message', (data: ArrayBuffer | Buffer) => {
      const bytes =
        data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      for (const handler of this.handlers.message) handler(bytes);
    });
    socket.on('close', () => {
      this._state = 'closed';
      for (const handler of this.handlers.close) handler('socket closed');
    });
    socket.on('error', (error: Error) => {
      for (const handler of this.handlers.error) handler(error);
    });
  }

  get state(): TransportState {
    return this._state;
  }

  async connect(): Promise<void> {
    /* Already connected — the server accepts, it does not dial. */
  }

  send(data: Uint8Array): void {
    if (this.socket.readyState !== 1) return;
    this.socket.send(data);
  }

  close(reason = 'closed'): void {
    this._state = 'closed';
    this.socket.close(1000, reason);
  }

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): () => void {
    this.handlers[event].add(handler as never);
    return () => {
      this.handlers[event].delete(handler as never);
    };
  }
}

interface ServerArgs {
  port: number;
  maxClients: number;
  settings: MatchSettings;
}

function parseArgs(argv: string[]): ServerArgs {
  const settings = defaultMatchSettings();
  let port = 8080;
  let maxClients = 16;

  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) continue;
    switch (key.slice(2)) {
      case 'port':
        port = Number(value) || port;
        break;
      case 'max':
        maxClients = Number(value) || maxClients;
        break;
      case 'mode':
        settings.mode = value as MatchSettings['mode'];
        break;
      case 'arena':
        settings.arena = value;
        break;
      case 'bots':
        settings.botsPerTeam = Number(value) || 0;
        settings.botsEnabled = Number(value) > 0;
        break;
      case 'seed':
        settings.seed = Number(value) || settings.seed;
        break;
      default:
        break;
    }
  }
  return { port, maxClients, settings };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[photon] starting dedicated server on :${args.port}`);
  console.log(`[photon] mode=${args.settings.mode} arena=${args.settings.arena} max=${args.maxClients}`);

  const server = new NetServer({
    maxClients: args.maxClients,
    settings: args.settings,
    createMatch: async () => {
      await initPhysics();
      const physics = new PhysicsWorld();
      const definition = getArena(args.settings.arena);
      buildArena(physics, definition);

      const bakeStart = Date.now();
      const nav = NavGraph.build(physics, definition);
      console.log(`[photon] navigation baked: ${nav.nodeCount} nodes in ${Date.now() - bakeStart} ms`);

      const events = new EventBus<GameEvents>();
      const director = new MatchDirector(args.settings, definition, physics, nav, events);
      director.populateBots();
      return { director, events };
    },
  });

  await server.start();

  const wss = new WebSocketServer({ port: args.port });
  wss.on('connection', (socket) => {
    const client = server.accept(new WsTransport(socket));
    console.log(`[photon] client ${client.id} connected (${server.clientCount} online)`);
  });

  // Periodic health line, so an operator can see the server is alive and what it costs.
  let lastCpu = process.cpuUsage();
  let lastCpuAt = Date.now();
  setInterval(() => {
    const memory = process.memoryUsage();
    // CPU as a share of one core over the interval, which is the number that decides how many
    // matches a host can run. Sampled as a delta rather than cumulatively, so it reflects load now.
    const cpu = process.cpuUsage(lastCpu);
    const elapsedMs = Date.now() - lastCpuAt;
    lastCpu = process.cpuUsage();
    lastCpuAt = Date.now();
    const cpuPercent = Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 1000) / 10;
    console.log(
      `[photon] clients=${server.clientCount} ` +
        `phase=${server.matchFlow.phase} ` +
        `tx=${(server.bandwidth.sentBytesPerSecond / 1024).toFixed(1)}KB/s ` +
        `rx=${(server.bandwidth.receivedBytesPerSecond / 1024).toFixed(1)}KB/s ` +
        `snapshot=${server.bandwidth.snapshotBytes}B ` +
        `heap=${(memory.heapUsed / 1024 / 1024).toFixed(0)}MB ` +
        `cpu=${cpuPercent}% ` +
        // Input starvation is the diagnostic for prediction drift: a starved tick means the server
        // ran ahead of a client's input stream and held that actor rather than guessing.
        `starved=${server
          .inputHealth()
          .map((h) => `${h.starvedPercent}%`)
          .join(',') || '-'}`,
    );
  }, 10_000);

  const shutdown = () => {
    console.log('[photon] shutting down');
    server.stop();
    wss.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[photon] fatal:', error);
  process.exit(1);
});
