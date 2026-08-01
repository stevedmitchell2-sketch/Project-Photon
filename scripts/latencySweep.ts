import { COMBAT } from '../src/config/combat';
import { MOVEMENT } from '../src/config/movement';
import type { Actor } from '../src/gameplay/types';
import { LoopbackSession, sleep, type InputPattern } from './lib/loopbackSession';

/**
 * Latency sweep.
 *
 * Answers the question three sprints of benchmarks have not: what actually happens to prediction,
 * hit registration and responsiveness as the link degrades. Everything before this was measured at
 * ~1 ms RTT, where lag compensation rewinds by nothing and proves nothing.
 *
 * The scenario is a duel, because that is the only arrangement in which lag compensation is
 * observable at all:
 *
 *   - the TARGET strafes continuously, so where it *is* and where the shooter *sees* it diverge by
 *     rtt/2 + the interpolation delay;
 *   - the SHOOTER aims at the position it renders — not at the server's truth — and fires. This is
 *     the honest client behaviour, and it is what a player does.
 *
 * Without rewind, hit rate must fall as latency rises, because the shooter is aiming at where the
 * target used to be. With rewind, it should stay roughly flat. That difference is the measurement.
 *
 *   npm run latency-sweep -- --seconds 8
 *   npm run latency-sweep -- --latencies 0,50,150 --seconds 6
 */

interface Row {
  rttMs: number;
  measuredRttMs: number;
  meanErrorMm: number;
  maxErrorMm: number;
  correctionsPerSecond: number;
  comparisons: number;
  shotsFired: number;
  shotsHit: number;
  hitPercent: number;
  responsivenessMs: number;
  downKbps: number;
  upKbps: number;
  serverTickHz: number;
  snapshotsReceived: number;
  snapshotsDropped: number;
  interpDelayMs: number;
  droppedInputs: number;
  starvedPercent: number;
}

function parseArgs(argv: string[]) {
  let latencies = [0, 20, 40, 60, 80, 100, 150, 200, 250];
  let seconds = 8;
  let lossPercent = 0;
  let lagComp = true;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    const value = argv[i + 1];
    if (key === 'latencies') latencies = value.split(',').map(Number).filter((n) => !Number.isNaN(n));
    if (key === 'seconds') seconds = Number(value) || seconds;
    if (key === 'loss') lossPercent = Number(value) || 0;
    if (key === 'lagcomp') lagComp = value !== 'off';
  }
  return { latencies, seconds, lossPercent, lagComp };
}

const eyeY = (actor: Actor): number => actor.position.y + actor.height - MOVEMENT.eyeOffsetFromTop;

/** Shortest signed angle from `from` to `to`. Look input is a delta, not an absolute heading. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Finds an open firing position a fixed distance from the target with clear line of sight.
 *
 * Spawns are team-based and often separated by geometry, so the pair has to be placed deliberately.
 * The server is authoritative, so placing them there is the sanctioned way to do it — the clients
 * are corrected onto the new positions within a snapshot.
 */
function findFiringPosition(
  session: LoopbackSession,
  target: Actor,
  distance: number,
): { x: number; y: number; z: number } | null {
  const from = { x: target.position.x, y: eyeY(target), z: target.position.z };
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2;
    const candidate = {
      x: target.position.x + Math.cos(angle) * distance,
      y: target.position.y,
      z: target.position.z + Math.sin(angle) * distance,
    };
    const to = { x: candidate.x, y: from.y, z: candidate.z };
    if (session.hasLineOfSight(from, to)) return candidate;
  }
  return null;
}

async function measure(
  rttMs: number,
  seconds: number,
  lossPercent: number,
  lagComp: boolean,
): Promise<Row> {
  // One-way delay is half the round trip; LocalTransport delays each direction independently.
  const oneWay = rttMs / 2;
  const session = new LoopbackSession({
    settings: { botsEnabled: false, botsPerTeam: 0, mode: 'team_deathmatch' },
  });
  await session.start();
  // Turning rewind off is the control condition: it isolates how much of the hit rate at a given
  // latency is lag compensation doing its job, rather than the shot simply being easy.
  session.director.enableLagCompensation(lagComp);

  const shooter = await session.addClient('SHOOTER', 'red', oneWay, lossPercent);
  const target = await session.addClient('TARGET', 'blue', oneWay, lossPercent);

  const serverShooter = session.director.state.actors.get(shooter.client.actorId)!;
  const serverTarget = session.director.state.actors.get(target.client.actorId)!;

  // Place the duel somewhere both parties can see each other. 14 m is inside the weapon's
  // falloff-free band, so damage does not confound the hit count.
  const spot = findFiringPosition(session, serverTarget, 14);
  if (!spot) throw new Error('no clear firing position found near the target spawn');
  session.placeActor(serverShooter, spot);

  // Let the clients be corrected onto their placed positions before measuring anything.
  await session.run(0.75, [() => ({}), () => ({})]);

  const before = {
    tick: session.director.state.tick,
    at: Date.now(),
  };
  session.server.stats.get(serverShooter.id)!.shotsFired = 0;
  session.server.stats.get(serverShooter.id)!.shotsHit = 0;

  // Discard the settle phase. Placing the shooter is a 14 m server-authored teleport, and counting
  // that as a prediction failure would swamp every real error in the run.
  for (const handle of [shooter, target]) {
    const rs = handle.client.reconciler.stats;
    rs.errorSumMetres = 0;
    rs.maxErrorMetres = 0;
    rs.totalCorrections = 0;
    rs.comparisons = 0;
    rs.lookupMisses = 0;
  }

  let lagTickSum = 0;
  let lagTickSamples = 0;

  const aimAndFire: InputPattern = () => {
    const self = shooter.director.state.actors.get(shooter.director.state.localActorId);
    if (!self) return {};

    // Aim at the *rendered* target — the interpolated sample the player would actually see —
    // rather than at the server's current truth. Using the truth here would silently test nothing.
    const seen = shooter.client.remoteActors.get(target.client.actorId);
    const mirrored = shooter.director.state.actors.get(target.client.actorId);
    const px = seen?.px ?? mirrored?.position.x;
    const py = seen?.py ?? mirrored?.position.y;
    const pz = seen?.pz ?? mirrored?.position.z;
    if (px === undefined || py === undefined || pz === undefined) return {};

    const height = seen?.height ?? mirrored?.height ?? MOVEMENT.standHeight;
    const aimY = py + height * 0.55;
    const selfEye = eyeY(self);
    const dx = px - self.position.x;
    const dz = pz - self.position.z;
    const flat = Math.hypot(dx, dz);
    // Engine forward is (-sin yaw, sin pitch, -cos yaw), so the heading that points at (dx, dz)
    // is atan2(-dx, -dz). Using atan2(dx, dz) aims exactly backwards and scores nothing.
    const desiredYaw = Math.atan2(-dx, -dz);
    const desiredPitch = Math.atan2(aimY - selfEye, flat);

    // Bolts leave along (yaw + recoilYaw, pitch + recoilPitch), so a controller that ignores recoil
    // walks its shots off the target within one cell and buries the latency signal in weapon noise.
    // A player compensates; so does this.
    return {
      lookYaw: angleDelta(self.yaw + self.weapon.recoilYaw, desiredYaw),
      lookPitch: angleDelta(self.pitch + self.weapon.recoilPitch, desiredPitch),
      fire: true,
      firePressed: true,
    };
  };

  // A continuous strafe is what makes rewind matter: at 250 ms the target has moved most of a body
  // width between the frame the shooter aimed at and the tick the server resolves the bolt on.
  const strafe: InputPattern = (t) => ({ moveX: Math.sin(t / 22), sprint: true });

  const wall = await session.run(seconds, [aimAndFire, strafe], () => {
    // Keep the target on its feet. It is a dummy: a death would teleport it to a spawn point and
    // destroy the geometry the measurement depends on. Damage still lands and is still counted.
    serverTarget.health = COMBAT.maxHealth;
    serverTarget.shield = COMBAT.maxShield;
    lagTickSum += shooter.client.stats.acknowledgedLagTicks;
    lagTickSamples++;
  });

  const s = shooter.client.stats;
  // Prediction accuracy is read from the TARGET, because the target is the one that moves. The
  // shooter stands still to aim, and a stationary actor predicts itself perfectly at any latency —
  // reporting its error would show a flat 1 mm and say nothing at all about prediction.
  const p = target.client.stats;
  const shooterStats = session.server.stats.get(serverShooter.id)!;
  const health = session.server.inputHealth().find((h) => h.id === 2);
  const serverTicks = session.director.state.tick - before.tick;
  const elapsed = (Date.now() - before.at) / 1000;

  const row: Row = {
    rttMs,
    measuredRttMs: s.quality.rttMs,
    meanErrorMm: Math.round(p.meanErrorMetres * 1000),
    maxErrorMm: Math.round(p.maxErrorMetres * 1000),
    correctionsPerSecond: Math.round((p.totalCorrections / wall) * 10) / 10,
    comparisons: p.comparisons,
    shotsFired: shooterStats.shotsFired,
    shotsHit: shooterStats.shotsHit,
    hitPercent:
      shooterStats.shotsFired > 0
        ? Math.round((shooterStats.shotsHit / shooterStats.shotsFired) * 1000) / 10
        : 0,
    responsivenessMs:
      lagTickSamples > 0 ? Math.round((lagTickSum / lagTickSamples) * (1000 / 64) * 10) / 10 : 0,
    downKbps: Math.round((s.downstreamBps / 1024) * 10) / 10,
    upKbps: Math.round((s.upstreamBps / 1024) * 10) / 10,
    serverTickHz: Math.round((serverTicks / elapsed) * 10) / 10,
    snapshotsReceived: s.snapshotsReceived,
    snapshotsDropped: s.snapshotsDropped,
    interpDelayMs: s.interpolationDelayMs,
    droppedInputs: health?.dropped ?? -1,
    starvedPercent: health?.starvedPercent ?? -1,
  };

  session.dispose();
  await sleep(120);
  return row;
}

function table(rows: Row[]): void {
  const line = (cells: string[], widths: number[]) =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';

  const headers = [
    'RTT set',
    'RTT seen',
    'Mean err',
    'Max err',
    'Corr/s',
    'Shots',
    'Hits',
    'Hit %',
    'Ack lag',
    'Down',
    'Up',
    'Srv Hz',
    'Interp',
    'DropSnap',
    'DropIn',
    'Starved',
  ];
  const body = rows.map((r) => [
    `${r.rttMs} ms`,
    `${r.measuredRttMs} ms`,
    `${r.meanErrorMm} mm`,
    `${r.maxErrorMm} mm`,
    `${r.correctionsPerSecond}`,
    `${r.shotsFired}`,
    `${r.shotsHit}`,
    `${r.hitPercent}%`,
    `${r.responsivenessMs} ms`,
    `${r.downKbps} KB/s`,
    `${r.upKbps} KB/s`,
    `${r.serverTickHz}`,
    `${r.interpDelayMs} ms`,
    `${r.snapshotsDropped}`,
    `${r.droppedInputs}`,
    `${r.starvedPercent}%`,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length)),
  );

  console.log('\n' + line(headers, widths));
  console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|');
  for (const row of body) console.log(line(row, widths));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sweep] duel scenario, ${args.seconds}s per point, loss ${args.lossPercent}%, ` +
      `latencies ${args.latencies.join('/')} ms RTT, lag compensation ${args.lagComp ? 'ON' : 'OFF'}`,
  );

  const rows: Row[] = [];
  for (const rtt of args.latencies) {
    process.stdout.write(`[sweep] ${rtt} ms ... `);
    const row = await measure(rtt, args.seconds, args.lossPercent, args.lagComp);
    rows.push(row);
    console.log(
      `hit ${row.hitPercent}% (${row.shotsHit}/${row.shotsFired}), ` +
        `mean err ${row.meanErrorMm} mm, ${row.correctionsPerSecond} corr/s`,
    );
  }

  table(rows);
  console.log(
    '\nRTT seen is the client\'s own ping measurement; it includes one server tick of scheduling\n' +
      'delay on top of the injected link latency, which is why it reads slightly high.\n',
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('[sweep] fatal:', error);
  process.exit(1);
});
