import { NavGraph } from '../src/ai/NavGraph';
import { defaultMatchSettings } from '../src/config/gameModes';
import { EventBus } from '../src/engine/EventBus';
import { TICK_DT } from '../src/engine/GameLoop';
import { MatchDirector } from '../src/gameplay/MatchDirector';
import type { GameEvents } from '../src/gameplay/types';
import { createInputFrame } from '../src/input/InputFrame';
import { buildArena, getArena } from '../src/maps/MapBuilder';
import { NetClient } from '../src/net/NetClient';
import { WebSocketTransport } from '../src/net/Transport';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';

/**
 * One networked client, alone in its own process.
 *
 * The counterpart to `netTest.ts`, which runs every client in a single process and a single event
 * loop. That co-location has been the standing suspect for the residual prediction corrections for
 * three sprints, and it is not testable from inside the process doing the co-locating.
 *
 * This process owns exactly one client: its own physics world, arena, director and session, driven
 * by its own 64 Hz loop with nothing else competing for the thread. It writes a single JSON line to
 * stdout when it finishes, which `processScale.ts` collects.
 *
 * Not run directly — see `npm run scale`.
 */

interface Args {
  port: number;
  name: string;
  team: string | null;
  seconds: number;
}

function parseArgs(argv: string[]): Args {
  let port = 8090;
  let name = 'PROC';
  let team: string | null = null;
  let seconds = 12;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    const value = argv[i + 1];
    if (key === 'port') port = Number(value) || port;
    if (key === 'name') name = value ?? name;
    if (key === 'team') team = value || null;
    if (key === 'seconds') seconds = Number(value) || seconds;
  }
  return { port, name, team, seconds };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await initPhysics();
  const physics = new PhysicsWorld();
  const settings = defaultMatchSettings();
  const definition = getArena(settings.arena);
  buildArena(physics, definition);
  const nav = NavGraph.build(physics, definition);
  const events = new EventBus<GameEvents>();
  const director = new MatchDirector(settings, definition, physics, nav, events);
  director.createLocalPlayer(args.name);

  const transport = new WebSocketTransport(`ws://127.0.0.1:${args.port}`);
  const client = new NetClient(transport, director, physics, events);
  await client.connect(args.name, args.team);

  const cpuBefore = process.cpuUsage();
  const startedAt = Date.now();
  const totalTicks = args.seconds * 64;
  let tick = 0;
  let travelled = 0;
  let last = { x: 0, z: 0 };
  // Peak, not final. Clients are launched together but finish at slightly different moments, so by
  // the time the last one stops, the first ones have already disconnected and been reaped from its
  // world. Sampling at the end reports a peer count that has legitimately shrunk as a replication
  // failure.
  let peakPeers = 0;

  // Identical pattern in every process, so any difference between them is about the process rather
  // than about what it was asked to do.
  const pattern = (t: number) => ({ moveX: Math.sin(t / 22), sprint: true });

  while (tick < totalTicks) {
    const target = Math.min(totalTicks, Math.round(((Date.now() - startedAt) / 1000) * 64));
    while (tick < target) {
      const local = director.state.actors.get(director.state.localActorId);
      if (local) {
        const frame = createInputFrame();
        Object.assign(frame, pattern(tick));
        frame.tick = tick;
        Object.assign(local.input, frame);
        client.sendInput(local.input);
        director.step(TICK_DT);
        client.recordPrediction();
        client.update(TICK_DT);

        if (tick > 0) travelled += Math.hypot(local.position.x - last.x, local.position.z - last.z);
        last = { x: local.position.x, z: local.position.z };
        peakPeers = Math.max(peakPeers, director.state.actors.size - 1);
      }
      tick++;
    }
    await sleep(2);
  }

  const wall = (Date.now() - startedAt) / 1000;
  const cpu = process.cpuUsage(cpuBefore);
  const memory = process.memoryUsage();
  const s = client.stats;

  // A single line of JSON on stdout is the whole protocol back to the parent.
  console.log(
    JSON.stringify({
      name: args.name,
      actorId: s.actorId,
      connected: s.connected,
      snapshotsReceived: s.snapshotsReceived,
      snapshotsDropped: s.snapshotsDropped,
      corrections: s.totalCorrections,
      correctionsPerSecond: Math.round((s.totalCorrections / wall) * 10) / 10,
      meanErrorMm: Math.round(s.meanErrorMetres * 1000),
      maxErrorMm: Math.round(s.maxErrorMetres * 1000),
      comparisons: s.comparisons,
      lookupMisses: s.lookupMisses,
      rttMs: s.quality.rttMs,
      ackLagTicks: s.acknowledgedLagTicks,
      downKbps: Math.round((s.downstreamBps / 1024) * 10) / 10,
      upKbps: Math.round((s.upstreamBps / 1024) * 10) / 10,
      travelledM: Math.round(travelled * 10) / 10,
      peersSeen: peakPeers,
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / (wall * 1000)) * 1000) / 10,
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapMb: Math.round(memory.heapUsed / 1024 / 1024),
      wallSeconds: Math.round(wall * 10) / 10,
    }),
  );

  client.dispose();
  process.exit(0);
}

main().catch((error) => {
  console.error(JSON.stringify({ error: String(error) }));
  process.exit(1);
});
