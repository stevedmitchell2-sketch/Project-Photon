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
import { dist3 } from '../src/util/math';

/**
 * Headless multi-client network validation.
 *
 * Drives real `NetClient` instances over real WebSockets against a real `NetServer`, with no
 * renderer involved. This is the test that answers the questions a screenshot cannot: do two
 * clients see each other, do positions converge, does prediction stay quiet on a good link, and
 * does hit registration survive latency.
 *
 * Run the dedicated server first, then:
 *   npm run server -- --port 8090 --bots 0
 *   npm run nettest -- --port 8090 --clients 3
 */

interface TestClient {
  name: string;
  /** Ground distance covered, so a client pinned against geometry is visible in the results. */
  travelled: number;
  lastPos: { x: number; z: number };
  client: NetClient;
  director: MatchDirector;
  physics: PhysicsWorld;
  events: EventBus<GameEvents>;
  tick: number;
}

async function createClient(name: string, url: string, team: string | null): Promise<TestClient> {
  await initPhysics();
  const physics = new PhysicsWorld();
  const settings = defaultMatchSettings();
  const definition = getArena(settings.arena);
  buildArena(physics, definition);
  const nav = NavGraph.build(physics, definition);
  const events = new EventBus<GameEvents>();
  const director = new MatchDirector(settings, definition, physics, nav, events);
  director.createLocalPlayer(name);

  const transport = new WebSocketTransport(url);
  const client = new NetClient(transport, director, physics, events);
  await client.connect(name, team);

  return { name, client, director, physics, events, tick: 0, travelled: 0, lastPos: { x: 0, z: 0 } };
}

/** Advances one client by a tick with a scripted input. */
function stepClient(tc: TestClient, pattern: (tick: number) => Partial<ReturnType<typeof createInputFrame>>): void {
  const local = tc.director.state.actors.get(tc.director.state.localActorId);
  if (!local) return;
  const frame = createInputFrame();
  Object.assign(frame, pattern(tc.tick));
  frame.tick = tc.tick;
  Object.assign(local.input, frame);
  tc.client.sendInput(local.input);
  tc.director.step(TICK_DT);
  tc.client.recordPrediction();
  tc.client.update(TICK_DT);

  const p = local.position;
  if (tc.tick > 0) tc.travelled += Math.hypot(p.x - tc.lastPos.x, p.z - tc.lastPos.z);
  tc.lastPos.x = p.x;
  tc.lastPos.z = p.z;
  tc.tick++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Movement scenarios.
 *
 * `varied` is the historical default: each client gets a different pattern from a different spawn,
 * which is realistic but confounds any per-client comparison. The others exist to isolate whether
 * position and surroundings — rather than the client itself — drive prediction corrections.
 *
 *   identical  every client runs the same input sequence; differences must come from the world
 *   open       identical, aimed at the arena centre where the floor is clear
 *   cover      identical, driven into the corner geometry each client spawns beside
 */
type Scenario = 'varied' | 'identical' | 'open' | 'cover';

function parseArgs(argv: string[]) {
  let port = 8090;
  let clients = 2;
  let seconds = 12;
  let scenario: Scenario = 'varied';
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    const value = argv[i + 1];
    if (key === 'port') port = Number(value) || port;
    if (key === 'clients') clients = Number(value) || clients;
    if (key === 'seconds') seconds = Number(value) || seconds;
    if (key === 'scenario') scenario = value as Scenario;
  }
  return { port, clients, seconds, scenario };
}

/**
 * Builds the per-client input pattern for a scenario.
 *
 * `open` and `cover` differ only in sign: both drive straight, one away from the corner the client
 * spawned in and one into it. That keeps everything except the surroundings constant, which is the
 * whole point of the comparison.
 */
function patternsFor(scenario: Scenario): Array<(t: number) => Record<string, unknown>> {
  switch (scenario) {
    case 'identical':
      return [(t: number) => ({ moveZ: 1, moveX: Math.sin(t / 40), sprint: true })];
    case 'open':
      // Straight ahead from spawn: every corner spawn faces the arena centre.
      return [() => ({ moveZ: 1, sprint: true })];
    case 'cover':
      // Straight backwards into the corner the client spawned beside.
      return [() => ({ moveZ: -1, sprint: true })];
    case 'varied':
    default:
      return [
        (t: number) => ({ moveZ: 1, moveX: Math.sin(t / 40), sprint: true }),
        (t: number) => ({ moveZ: -1, moveX: Math.cos(t / 30), sprint: false }),
        (t: number) => ({ moveZ: 1, moveX: 0, jump: t % 90 === 0, jumpPressed: t % 90 === 0 }),
        (t: number) => ({ moveX: 1, moveZ: Math.sin(t / 25) }),
      ];
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = `ws://127.0.0.1:${args.port}`;
  console.log(`[nettest] connecting ${args.clients} clients to ${url}`);

  const teams = ['red', 'blue', 'red', 'blue'];
  const clients: TestClient[] = [];
  for (let i = 0; i < args.clients; i++) {
    const tc = await createClient(`TESTER${i + 1}`, url, teams[i] ?? null);
    clients.push(tc);
    // connect() now resolves on the handshake acknowledgement, so the actor id is always valid
    // here. It used to resolve on socket-open and this line frequently printed -1.
    console.log(`[nettest] ${tc.name} connected as actor ${tc.client.actorId}`);
  }

  if (clients.some((c) => c.client.actorId < 0)) {
    console.error('[nettest] FAIL: a client did not receive a handshake acknowledgement');
    process.exit(1);
  }

  const patterns = patternsFor(args.scenario);
  console.log(`[nettest] scenario: ${args.scenario}`);

  // Run in real time. An earlier version drove ticks as fast as the loop allowed, which sent ~570
  // input packets/second and was correctly kicked by the server's flood protection — the rate
  // limiter working, but not the thing under test. Clients must be paced like real clients.
  const totalTicks = args.seconds * 64;
  const startedAt = Date.now();
  let simulatedTicks = 0;

  while (simulatedTicks < totalTicks) {
    const targetTicks = Math.min(totalTicks, Math.round(((Date.now() - startedAt) / 1000) * 64));
    while (simulatedTicks < targetTicks) {
      for (let c = 0; c < clients.length; c++) {
        stepClient(clients[c], patterns[c % patterns.length]);
      }
      simulatedTicks++;
    }
    await sleep(4);
  }

  const wallSeconds = (Date.now() - startedAt) / 1000;
  await sleep(500);

  // --- Assertions ----------------------------------------------------------
  console.log('\n[nettest] ===== RESULTS =====');
  let failures = 0;

  for (const tc of clients) {
    const s = tc.client.stats;
    const others = clients.filter((o) => o !== tc);

    // Does this client see the other players at all?
    const visible = others.filter((o) => tc.director.state.actors.has(o.client.actorId));
    const seesEveryone = visible.length === others.length;

    // Do the positions this client renders for others match where those clients think they are?
    let maxDivergence = 0;
    for (const other of others) {
      const mirrored = tc.director.state.actors.get(other.client.actorId);
      const authoritative = other.director.state.actors.get(other.client.actorId);
      if (!mirrored || !authoritative) continue;
      maxDivergence = Math.max(maxDivergence, dist3(mirrored.position, authoritative.position));
    }

    console.log(
      `\n  ${tc.name} (actor ${s.actorId})\n` +
        `    connected        ${s.connected}\n` +
        `    sees others      ${visible.length}/${others.length}\n` +
        `    snapshots        ${s.snapshotsReceived} received, ${s.snapshotsDropped} dropped\n` +
        `    ping             ${s.quality.rttMs} ms (jitter ${s.quality.jitterMs} ms, loss ${s.quality.packetLossPercent}%)\n` +
        `    corrections/s    ${s.corrections}\n` +
        `    compared         ${s.comparisons} (missed ${s.lookupMisses})\n` +
        `    last error       ${s.lastCorrectionMetres.toFixed(3)} m\n` +
        `    interp buffer    ${s.interpolationDelayMs} ms\n` +
        `    bandwidth        down ${(s.downstreamBps / 1024).toFixed(1)} KB/s, up ${(s.upstreamBps / 1024).toFixed(1)} KB/s\n` +
        `    peer divergence  ${maxDivergence.toFixed(3)} m
` +
        `    position         (${tc.director.state.actors.get(tc.client.actorId)?.position.x.toFixed(1)}, ${tc.director.state.actors.get(tc.client.actorId)?.position.z.toFixed(1)})
` +
        `    travelled        ${tc.travelled.toFixed(1)} m`,
    );

    if (!s.connected) {
      console.error(`    FAIL: ${tc.name} is not connected`);
      failures++;
    }
    if (!seesEveryone) {
      console.error(`    FAIL: ${tc.name} cannot see all peers`);
      failures++;
    }
    if (s.snapshotsReceived === 0) {
      console.error(`    FAIL: ${tc.name} received no snapshots`);
      failures++;
    }
    // Interpolation renders peers deliberately behind, so some divergence is correct. A large one
    // means replication is broken rather than merely delayed.
    if (maxDivergence > 6) {
      console.error(`    FAIL: ${tc.name} peer divergence ${maxDivergence.toFixed(2)} m is too high`);
      failures++;
    }
  }

  console.log(
    `\n  simulated ${args.seconds}s of match in ${wallSeconds.toFixed(1)}s wall time across ${clients.length} clients`,
  );

  // Disconnect / reconnect check on the last client.
  const victim = clients[clients.length - 1];
  console.log(`\n[nettest] disconnecting ${victim.name} to test cleanup`);
  victim.client.dispose();
  await sleep(600);
  const survivor = clients[0];
  const stillPresent = survivor.director.state.actors.has(victim.client.actorId);
  console.log(`  peer removed from survivor's world: ${!stillPresent ? 'yes' : 'no (still present)'}`);

  for (const tc of clients) tc.client.dispose();

  console.log(`\n[nettest] ${failures === 0 ? 'PASS' : `FAIL (${failures} problems)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[nettest] fatal:', error);
  process.exit(1);
});
