import { afterEach, describe, expect, it } from 'vitest';
import { LoopbackSession, sleep } from '../../scripts/lib/loopbackSession';

/**
 * Regression protection for the actor-identity bug.
 *
 * A networked client creates a local player *before* it connects, so the match is playable while
 * the handshake is in flight. The server then assigns the id that player will really have. Until
 * Sprint 7 nothing merged those two identities, and the consequence depended entirely on what the
 * server's id counter happened to be:
 *
 *   - server id unoccupied locally → the snapshot reaper deleted the local player as a departed
 *     peer, and the client silently stopped simulating, sending input, or receiving anything it
 *     could act on;
 *   - server id occupied locally (any server with bots) → every snapshot overwrote the local
 *     player with a bot's state.
 *
 * The bug was invisible for three sprints because the only multi-client testing used a *freshly
 * started, botless* server, where local ids 1..N coincidentally equalled server ids 1..N. It
 * presented as "the server degrades after clients disconnect" and "the client limit is four" —
 * both of which were really "the server's id counter has moved past 1".
 *
 * These tests therefore all use a server whose counter has already advanced, which is the normal
 * case in production and the case that was never exercised.
 */

let session: LoopbackSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
});

const idle = () => ({});

describe('local actor identity', () => {
  it('adopts the server-assigned id when the server counter has advanced', async () => {
    // Bots occupy ids 1..N, so the joining client cannot be given id 1.
    session = new LoopbackSession({
      settings: { botsEnabled: true, botsPerTeam: 3 },
    });
    await session.start();

    const handle = await session.addClient('TESTER');
    const serverId = handle.client.actorId;

    expect(serverId).toBeGreaterThan(1);
    // The director must now agree with the server about who the local player is.
    expect(handle.director.state.localActorId).toBe(serverId);

    const local = handle.director.state.actors.get(serverId);
    expect(local).toBeDefined();
    expect(local!.id).toBe(serverId);
    expect(local!.name).toBe('TESTER');
    // The pre-connection placeholder must not survive as a second, orphaned actor.
    expect(handle.director.state.actors.get(1)!.name).not.toBe('TESTER');
  });

  it('keeps simulating the local player after snapshots start arriving', async () => {
    session = new LoopbackSession({ settings: { botsEnabled: true, botsPerTeam: 3 } });
    await session.start();
    const handle = await session.addClient('TESTER');
    const serverId = handle.client.actorId;

    await session.run(1.5, [() => ({ moveZ: 1, sprint: true })]);

    // The precise failure the bug produced: the local actor is reaped, `stepClient` finds nothing
    // to drive, and every downstream number stays at its initial value forever.
    expect(handle.director.state.actors.has(serverId)).toBe(true);
    expect(handle.client.stats.snapshotsReceived).toBeGreaterThan(10);
    expect(handle.travelled).toBeGreaterThan(1);
    expect(handle.client.stats.comparisons).toBeGreaterThan(5);
  });

  it('does not glue the local player to a bot that holds its old id', async () => {
    session = new LoopbackSession({ settings: { botsEnabled: true, botsPerTeam: 3 } });
    await session.start();
    const handle = await session.addClient('TESTER');
    const serverId = handle.client.actorId;

    await session.run(1.5, [() => ({ moveZ: 1, sprint: true })]);

    const local = handle.director.state.actors.get(serverId)!;
    const authoritative = session.director.state.actors.get(serverId)!;
    const bot = handle.director.state.actors.get(1)!;

    // The client's own player must track the server's copy of *itself*, not of actor 1.
    const toSelf = Math.hypot(local.position.x - authoritative.position.x, local.position.z - authoritative.position.z);
    expect(toSelf).toBeLessThan(2);
    expect(local).not.toBe(bot);
  });

  it('reclaims the actor when a client is kicked, not only when it disconnects cleanly', async () => {
    session = new LoopbackSession({ settings: { botsEnabled: false, botsPerTeam: 0 } });
    await session.start();

    const handle = await session.addClient('TESTER');
    const serverId = handle.client.actorId;
    expect(session.director.state.actors.has(serverId)).toBe(true);

    // A kick used to remove the client record while leaving its actor standing in the arena for
    // the lifetime of the server — replicated to everyone, occupying a spawn, costing a capsule.
    handle.client.dispose();
    await sleep(150);

    expect(session.server.clientCount).toBe(0);
    expect(session.director.state.actors.has(serverId)).toBe(false);
  });

  it('survives a full generation of clients leaving and a new one joining', async () => {
    session = new LoopbackSession({ settings: { botsEnabled: false, botsPerTeam: 0 } });
    await session.start();

    const first = await session.addClient('GEN1A');
    const second = await session.addClient('GEN1B');
    await session.run(0.6, [idle]);

    first.client.dispose();
    second.client.dispose();
    session.clients.length = 0;
    await sleep(200);

    // This is the exact sequence that produced "the server degrades after a disconnect". The
    // second generation lands on ids the first generation used up.
    const third = await session.addClient('GEN2A');
    await session.run(1.2, [() => ({ moveZ: 1, sprint: true })]);

    expect(third.client.actorId).toBeGreaterThan(2);
    expect(third.director.state.localActorId).toBe(third.client.actorId);
    expect(third.client.stats.snapshotsReceived).toBeGreaterThan(10);
    expect(third.travelled).toBeGreaterThan(1);
  });
});
