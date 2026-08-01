import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Process-per-client scaling harness.
 *
 * Starts a dedicated server and N client processes, each owning one session on its own event loop,
 * and reports what it cost. This exists to settle two questions that a single-process harness
 * cannot answer about itself:
 *
 *   1. how many clients the server actually supports, measured without every client sharing one
 *      thread with every other client and with the measurement code;
 *   2. whether the residual prediction corrections are a property of the netcode or of co-location.
 *
 * Precedent argues for suspecting the apparatus first: the previous "the server does not scale past
 * four clients" finding turned out to be a client-side promise resolving too early, and the
 * "degrades after a disconnect" finding turned out to be the client never adopting its
 * server-assigned actor id. Both were measurement faults, not server faults.
 *
 *   npm run scale -- --clients 8 --seconds 15
 */

const here = dirname(fileURLToPath(import.meta.url));

interface ClientResult {
  name: string;
  actorId: number;
  connected: boolean;
  snapshotsReceived: number;
  snapshotsDropped: number;
  corrections: number;
  correctionsPerSecond: number;
  meanErrorMm: number;
  maxErrorMm: number;
  comparisons: number;
  rttMs: number;
  ackLagTicks: number;
  downKbps: number;
  upKbps: number;
  travelledM: number;
  peersSeen: number;
  cpuMs: number;
  cpuPercent: number;
  rssMb: number;
  heapMb: number;
  wallSeconds: number;
}

function parseArgs(argv: string[]) {
  let clients = 8;
  let seconds = 15;
  let port = 8110;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    const value = argv[i + 1];
    if (key === 'clients') clients = Number(value) || clients;
    if (key === 'seconds') seconds = Number(value) || seconds;
    if (key === 'port') port = Number(value) || port;
  }
  return { clients, seconds, port };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Launches a TypeScript entry point in a child process.
 *
 * Goes through `node --import tsx` rather than the `npx`/`tsx` shim. Spawning a `.cmd` on Windows
 * fails outright on current Node (EINVAL without `shell: true`), and turning the shell on would put
 * a command line containing this repository's spaces through cmd quoting for no benefit.
 */
const launch = (script: string, argv: string[]): ChildProcess =>
  spawn(process.execPath, ['--import', 'tsx', script, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });

/** Runs one client process to completion and parses its single JSON result line. */
function runClient(port: number, name: string, team: string, seconds: number): Promise<ClientResult | null> {
  return new Promise((resolve) => {
    const child = launch(join(here, 'clientProcess.ts'), [
      '--port', String(port), '--name', name, '--team', team, '--seconds', String(seconds),
    ]);
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (err += d.toString()));
    child.on('close', () => {
      // The client prints exactly one JSON line; anything else on stdout is noise from tooling.
      const line = out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
      if (!line) {
        console.error(`  ${name}: no result (${err.split('\n')[0] ?? 'no stderr'})`);
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(line) as ClientResult);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Server memory, sampled from the outside so it is not self-reported. */
function sampleServerMemory(pid: number): Promise<number> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(-1);
      return;
    }
    const child = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', () => {
      // "name","pid","session","session#","12,345 K"
      const match = out.match(/"([\d,]+) K"\s*$/m);
      resolve(match ? Math.round(Number(match[1].replace(/,/g, '')) / 1024) : -1);
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[scale] ${args.clients} client processes, ${args.seconds}s, port ${args.port}`);

  const server = launch(join(here, '..', 'server', 'index.ts'), [
    '--port', String(args.port), '--bots', '0',
  ]);
  let serverLog = '';
  server.stdout?.on('data', (d) => (serverLog += d.toString()));
  server.stderr?.on('data', (d) => (serverLog += d.toString()));

  // Wait for the navigation bake to finish before dialling in.
  for (let i = 0; i < 60 && !serverLog.includes('navigation baked'); i++) await sleep(500);
  if (!serverLog.includes('navigation baked')) {
    console.error('[scale] server did not start');
    server.kill();
    process.exit(1);
  }
  console.log('[scale] server up, launching clients');

  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: args.clients }, (_, i) =>
      runClient(args.port, `PROC${i + 1}`, i % 2 === 0 ? 'red' : 'blue', args.seconds),
    ),
  );
  const wall = (Date.now() - started) / 1000;
  const serverRssMb = server.pid ? await sampleServerMemory(server.pid) : -1;

  const ok = results.filter((r): r is ClientResult => r !== null && r.connected);
  console.log(`\n[scale] ${ok.length}/${args.clients} clients completed in ${wall.toFixed(1)}s\n`);

  const headers = ['Client', 'Actor', 'Peers', 'Snaps', 'Drop', 'Corr/s', 'Mean err', 'RTT', 'Down', 'Up', 'CPU', 'RSS'];
  const body = ok.map((r) => [
    r.name,
    String(r.actorId),
    `${r.peersSeen}/${args.clients - 1}`,
    String(r.snapshotsReceived),
    String(r.snapshotsDropped),
    String(r.correctionsPerSecond),
    `${r.meanErrorMm} mm`,
    `${r.rttMs} ms`,
    `${r.downKbps} KB/s`,
    `${r.upKbps} KB/s`,
    `${r.cpuPercent}%`,
    `${r.rssMb} MB`,
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells: string[]) => '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';

  console.log(line(headers));
  console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|');
  for (const row of body) console.log(line(row));

  const sum = (pick: (r: ClientResult) => number) => ok.reduce((a, r) => a + pick(r), 0);
  const mean = (pick: (r: ClientResult) => number) => (ok.length ? sum(pick) / ok.length : 0);

  console.log(
    `\n  clients completed   ${ok.length}/${args.clients}` +
      `\n  all peers visible   ${ok.every((r) => r.peersSeen >= args.clients - 1) ? 'yes' : 'no'}` +
      `\n  snapshots dropped   ${sum((r) => r.snapshotsDropped)}` +
      `\n  mean corrections/s  ${Math.round(mean((r) => r.correctionsPerSecond) * 10) / 10}` +
      `\n  mean error          ${Math.round(mean((r) => r.meanErrorMm))} mm` +
      `\n  client CPU each     ${Math.round(mean((r) => r.cpuPercent) * 10) / 10}% of one core` +
      `\n  client RSS each     ${Math.round(mean((r) => r.rssMb))} MB` +
      `\n  total client CPU    ${Math.round(sum((r) => r.cpuPercent) * 10) / 10}% of one core` +
      `\n  server RSS          ${serverRssMb} MB` +
      `\n  aggregate down      ${Math.round(sum((r) => r.downKbps) * 10) / 10} KB/s` +
      `\n  aggregate up        ${Math.round(sum((r) => r.upKbps) * 10) / 10} KB/s`,
  );

  const starved = serverLog.match(/starved=([^\s]+)/g);
  if (starved?.length) console.log(`  server starvation   ${starved[starved.length - 1]}`);
  const cpu = serverLog.match(/cpu=([\d.]+)%/g);
  if (cpu?.length) console.log(`  server CPU          ${cpu[cpu.length - 1].slice(4)} of one core`);

  server.kill();
  await sleep(300);
  process.exit(ok.length === args.clients ? 0 : 1);
}

main().catch((error) => {
  console.error('[scale] fatal:', error);
  process.exit(1);
});
