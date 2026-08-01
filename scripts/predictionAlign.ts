import { LoopbackSession, type InputPattern } from './lib/loopbackSession';

/**
 * Reconciliation alignment probe.
 *
 * The latency sweep shows a moving client correcting on every snapshot, with a mean error that
 * scales almost exactly with how far the server's acknowledgement lags the client's simulation:
 * roughly the distance the actor travels during that lag. Two very different things produce that
 * signature, and they have opposite fixes:
 *
 *   1. prediction genuinely diverges, and the divergence grows with the number of in-flight ticks;
 *   2. reconciliation compares the prediction for tick N against a server state that is not tick N,
 *      in which case the "error" is the actor's own legitimate motion and there is nothing to fix
 *      in the simulation at all.
 *
 * This distinguishes them. For every snapshot it measures the error against the stored prediction
 * at `acknowledgedTick + n` across a range of n. If reconciliation is aligned, error is minimised
 * at n = 0. If it is comparing across time, the minimum sits at the offset it is wrong by.
 *
 *   npm run predict-align -- --latency 150 --seconds 12
 */

function parseArgs(argv: string[]) {
  let latency = 100;
  let seconds = 12;
  let peers = 0;
  let index = 0;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    const value = argv[i + 1];
    if (key === 'latency') latency = Number(value) || 0;
    if (key === 'seconds') seconds = Number(value) || seconds;
    if (key === 'peers') peers = Number(value) || 0;
    if (key === 'index') index = Number(value) || 0;
  }
  return { latency, seconds, peers, index };
}

async function main(): Promise<void> {
  const { latency, seconds, peers, index } = parseArgs(process.argv.slice(2));
  const session = new LoopbackSession({ settings: { botsEnabled: false, botsPerTeam: 0 } });
  await session.start();

  // Which connected client is measured. Every previous sprint measured the first one; the netTest
  // results have consistently shown the first-connecting client quiet and later ones correcting on
  // every snapshot, so join order is itself a variable worth controlling.
  const all = [];
  for (let i = 0; i <= peers; i++) {
    all.push(await session.addClient(`CLIENT${i + 1}`, i % 2 === 0 ? 'red' : 'blue', latency / 2, 0));
  }
  const mover = all[Math.min(index, all.length - 1)];
  mover.client.reconciler.enableAlignmentProbe(24);

  // Continuous strafing, matching the latency sweep's moving client. The pattern matters: an
  // earlier version sprinted straight into a wall and covered under a metre a second, which made
  // every offset look equally good because the actor was barely moving.
  const pattern: InputPattern = (t) => ({ moveX: Math.sin(t / 22), sprint: true });

  // Every client runs the identical pattern, so any difference between them is about the session
  // rather than about what they were asked to do.
  // Server-side path length, accumulated from the authoritative actor. The client-side `travelled`
  // counter sums per-tick position deltas, which includes the jumps a correction produces — so a
  // client that corrects a lot reports a longer path without having actually gone anywhere. Only
  // the server's own copy distinguishes "moved further" from "was snapped around".
  const serverTravel = new Map<number, number>();
  const serverLast = new Map<number, { x: number; z: number }>();
  await session.run(seconds, new Array(all.length).fill(pattern), () => {
    for (const h of all) {
      const a = session.director.state.actors.get(h.client.actorId);
      if (!a) continue;
      const prev = serverLast.get(a.id);
      if (prev) {
        serverTravel.set(a.id, (serverTravel.get(a.id) ?? 0) + Math.hypot(a.position.x - prev.x, a.position.z - prev.z));
      }
      serverLast.set(a.id, { x: a.position.x, z: a.position.z });
    }
  });

  console.log('\n[align] per-client path length (client-measured vs server-measured):');
  for (const h of all) {
    const sv = serverTravel.get(h.client.actorId) ?? 0;
    console.log(
      `  ${h.name.padEnd(9)} client ${h.travelled.toFixed(1).padStart(7)} m   server ${sv.toFixed(1).padStart(7)} m   ` +
        `corrections ${h.client.stats.totalCorrections}`,
    );
  }

  const probe = mover.client.reconciler.alignmentProbe!;
  const rows: Array<{ offset: number; meanMm: number; samples: number }> = [];
  for (let i = 0; i < probe.sums.length; i++) {
    if (probe.counts[i] === 0) continue;
    rows.push({
      offset: i - probe.span,
      meanMm: Math.round((probe.sums[i] / probe.counts[i]) * 1000),
      samples: probe.counts[i],
    });
  }

  // Offsets far from the acknowledgement are only populated on the subset of snapshots where the
  // client happened to be running that far ahead. That subset is biased, so a "minimum" built from
  // a handful of samples means nothing — require most of the run to have contributed.
  const maxSamples = Math.max(...rows.map((r) => r.samples));
  const eligible = rows.filter((r) => r.samples >= maxSamples * 0.8);
  const best = eligible.reduce((a, b) => (b.meanMm < a.meanMm ? b : a));
  const atZero = rows.find((r) => r.offset === 0);

  console.log(`\n[align] ${latency} ms RTT, ${seconds}s, ${mover.travelled.toFixed(1)} m travelled`);
  console.log(`[align] acknowledgement lag ${mover.client.stats.acknowledgedLagTicks} ticks\n`);
  console.log('  offset  mean error  samples');
  for (const r of rows) {
    const mark = r.offset === best.offset ? '  <-- minimum' : r.samples < maxSamples * 0.8 ? '  (undersampled)' : '';
    console.log(`  ${String(r.offset).padStart(6)}  ${String(r.meanMm + ' mm').padStart(10)}  ${String(r.samples).padStart(7)}${mark}`);
  }

  console.log(
    `\n[align] error at offset 0: ${atZero?.meanMm ?? -1} mm; minimum ${best.meanMm} mm at offset ${best.offset}`,
  );
  console.log(
    best.offset === 0
      ? '[align] reconciliation is aligned — the residual error is genuine prediction divergence.\n'
      : `[align] reconciliation is comparing across ${best.offset} ticks of the actor's own motion.\n`,
  );

  session.dispose();
  process.exit(0);
}

main().catch((error) => {
  console.error('[align] fatal:', error);
  process.exit(1);
});
