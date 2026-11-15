import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createGiveawayService, defaultGiveawayAuthorization, GiveawayUserError, isActiveGiveaway, selectGiveawayWinners,
} from '../src/features/giveaways/service';
import type {
    CreateGiveaway, GiveawayDiagnostic, GiveawayMember, GiveawayRecord, GiveawayScheduler,
    GiveawayServiceOptions, GiveawayStore, GiveawayTransport, LocatedGiveaway,
} from '../src/features/giveaways/service';

import { handleGiveawayInteraction } from '../src/features/giveaways/discord';
import type { GiveawayButtonInteraction } from '../src/features/giveaways/discord';
const location = { guildId: 'guild', channelId: 'channel' };
const actor = { ...location, userId: 'alice' };
const host = { ...location, userId: 'host' };
const input: CreateGiveaway = { ...location, host: 'host', durationMs: 1000, winnerCount: 2, prize: 'A prize' };
function member(userId: string, overrides: Partial<GiveawayMember> = {}): GiveawayMember {
    return { userId, roleIds: [], administrator: false, manageGuild: false, manageEvents: false, bot: false, ...overrides };
}
function userError(message: RegExp): (error: unknown) => boolean {
    return error => {
        assert.ok(error instanceof GiveawayUserError);
        assert.match(error.message, message);
        return true;
    };
}
function infrastructureError(message: RegExp): (error: unknown) => boolean {
    return error => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof GiveawayUserError));
        assert.match(error.message, message);
        return true;
    };
}
function oldRecord(overrides: Partial<GiveawayRecord> = {}): GiveawayRecord {
    return { message: 'old', prize: 'Legacy prize', started: 1, entry: [], entered: 0, winCount: 2,
        requirements: { type: 'none' }, endTime: '2000', host: 'host', description: '', embeds: { legacy: true }, ...overrides };
}
class MemoryStore implements GiveawayStore {
    readonly records = new Map<string, GiveawayRecord>();
    failInsert = false;
    failSave = false;
    async list(): Promise<GiveawayRecord[]> { return structuredClone([...this.records.values()]); }
    async get(id: string): Promise<GiveawayRecord | null> { return structuredClone(this.records.get(id) ?? null); }
    async insert(record: GiveawayRecord): Promise<void> {
        if (this.failInsert) throw new Error('insert failed');
        if (this.records.has(record.message)) throw new Error('duplicate message');
        this.records.set(record.message, structuredClone(record));
    }
    async save(record: GiveawayRecord): Promise<void> {
        if (this.failSave) throw new Error('save failed');
        this.records.set(record.message, structuredClone(record));
    }
}
class ManualScheduler implements GiveawayScheduler {
    next = 0;
    readonly tasks = new Map<number, { task: () => void; delay: number }>();
    set(task: () => void, delay: number): number { const id = ++this.next; this.tasks.set(id, { task, delay }); return id; }
    clear(handle: unknown): void { if (typeof handle === 'number') this.tasks.delete(handle); }
    fire(): void {
        const first = this.tasks.entries().next().value;
        assert.ok(first);
        this.tasks.delete(first[0]);
        first[1].task();
    }
}
function setup(extra: Partial<GiveawayServiceOptions> = {}) {
    const store = new MemoryStore();
    const scheduler = new ManualScheduler();
    const members = new Map<string, GiveawayMember>(['host', 'alice', 'bob', 'carol'].map(id => [`guild:${id}`, member(id)]));
    members.set('guild:host', member('host', { manageEvents: true }));
    const published: LocatedGiveaway[] = [];
    const discarded: string[] = [];
    const diagnostics: GiveawayDiagnostic[] = [];
    const state = { time: 1000, verified: true, publishFailure: false, memberFailure: false, created: 0, createFailure: false, cleanupFailure: false };
    const transport: GiveawayTransport = {
        async create() { if (state.createFailure) throw new Error('send failed'); return `message-${++state.created}`; },
        async verify() { return state.verified; },
        async member(guildId, id) { if (state.memberFailure) throw new Error('member fetch failed'); return members.get(`${guildId}:${id}`) ?? null; },
        async publish(record) {
            if (state.publishFailure) throw new Error('publish failed');
            assert.ok(store.records.has(record.message), 'persist before publishing');
            published.push(structuredClone(record));
        },
        async discard(_location, id) { if (state.cleanupFailure) throw new Error('delete failed'); discarded.push(id); },
    };
    const service = createGiveawayService({ store, transport, scheduler, now: () => state.time,
        randomIndex: () => 0, diagnostic: issue => diagnostics.push(issue), ...extra });
    return { service, store, scheduler, members, published, discarded, diagnostics, state };
}

test('creation validates explicit values before sending or persisting', async () => {
    const f = setup();
    for (const invalid of [{ durationMs: 0 }, { durationMs: NaN }, { winnerCount: 0 }, { winnerCount: 1.5 }, { prize: ' ' }, { requirements: { type: 'role' as const } }]) {
        await assert.rejects(f.service.create({ ...input, ...invalid }), GiveawayUserError);
    }
    assert.equal(f.state.created, 0);
    const created = await f.service.create(input);
    assert.equal(created.pendingPublish, false);
    assert.equal(created.endTime, '2000');
    assert.equal(f.scheduler.tasks.size, 1);
    await f.service.stop();
});

test('concurrent entry toggles serialize and retain one entry per user', async () => {
    const f = setup();
    const record = await f.service.create(input);
    const [first, second] = await Promise.all([f.service.toggleEntry(record.message, actor), f.service.toggleEntry(record.message, actor)]);
    assert.equal(first.entered, true);
    assert.equal(second.entered, false);
    await Promise.all([f.service.toggleEntry(record.message, actor), f.service.toggleEntry(record.message, { ...actor, userId: 'bob' })]);
    assert.deepEqual((await f.store.get(record.message))?.entry.map(entry => entry.userId), ['alice', 'bob']);
    assert.equal((await f.store.get(record.message))?.entered, 2);
    await f.service.stop();
});

test('roles and required guild are checked against current membership, removals remain possible', async () => {
    const f = setup();
    const record = await f.service.create({ ...input, requirements: { type: 'role', id: 'required' } });
    await assert.rejects(f.service.toggleEntry(record.message, actor), userError(/requirements/));
    f.members.set('guild:alice', member('alice', { roleIds: ['required'] }));
    await f.service.toggleEntry(record.message, actor);
    f.members.delete('guild:alice');
    assert.equal((await f.service.toggleEntry(record.message, actor)).entered, false);
    const guildRecord = await f.service.create({ ...input, requirements: { type: 'guild', id: 'required-guild' } });
    f.members.set('guild:alice', member('alice'));
    await assert.rejects(f.service.toggleEntry(guildRecord.message, actor), userError(/requirements/));
    f.members.set('required-guild:alice', member('alice'));
    await f.service.toggleEntry(guildRecord.message, actor);
    await f.service.stop();
});

test('default authorization permits only Administrator or Manage Events', () => {
    const record: LocatedGiveaway = { ...oldRecord(), ...location };
    assert.equal(defaultGiveawayAuthorization(record, member('host')), false);
    assert.equal(defaultGiveawayAuthorization(record, member('outsider')), false);
    assert.equal(defaultGiveawayAuthorization(record, member('moderator', { manageGuild: true })), false);
    for (const flags of [{ administrator: true }, { manageEvents: true }]) {
        assert.equal(defaultGiveawayAuthorization(record, member('moderator', flags)), true);
    }
});

test('end and reroll enforce authorization and injectable restrictive policy', async () => {
    const defaults = setup();
    const active = await defaults.service.create(input);
    defaults.members.set('guild:host', member('host'));
    defaults.members.set('guild:alice', member('alice', { manageGuild: true }));
    for (const current of [host, actor]) {
        await assert.rejects(defaults.service.end(active.message, current), userError(/not authorized/));
        await assert.rejects(defaults.service.reroll(active.message, current), userError(/not authorized/));
    }
    defaults.members.set('guild:alice', member('alice', { manageEvents: true }));
    await defaults.service.end(active.message, actor);
    await defaults.service.reroll(active.message, actor);
    defaults.members.set('guild:bob', member('bob', { administrator: true }));
    await defaults.service.reroll(active.message, { ...actor, userId: 'bob' });
    await defaults.service.stop();
    const f = setup({ authorize: (_record, current) => current.userId === 'bob' });
    const record = await f.service.create(input);
    await assert.rejects(f.service.end(record.message, host), userError(/not authorized/));
    await assert.rejects(f.service.reroll(record.message, actor), userError(/not authorized/));
    await f.service.end(record.message, { ...actor, userId: 'bob' });
    await f.service.reroll(record.message, { ...actor, userId: 'bob' });
    const permissionFailure = new Error('permission provider unavailable');
    const brokenPolicy = setup({ authorize: () => { throw permissionFailure; } });
    const deniedRecord = await brokenPolicy.service.create(input);
    await assert.rejects(brokenPolicy.service.end(deniedRecord.message, host), error => error === permissionFailure);
    assert.equal(permissionFailure instanceof GiveawayUserError, false);
    await brokenPolicy.service.stop();
    await f.service.stop();
});

test('winner sampling is unique, bounded, deterministic, and rejects invalid randomness', () => {
    assert.deepEqual(selectGiveawayWinners(['a', 'a', 'b', 'c'], 10, () => 0), ['a', 'c', 'b']);
    assert.deepEqual(selectGiveawayWinners([], 2), []);
    assert.throws(() => selectGiveawayWinners(['a'], 1, () => 1), /random winner index/);
});

test('departed members and bots cannot win; rejoining restores eligibility on reroll', async () => {
    const f = setup();
    const record = await f.service.create(input);
    for (const userId of ['alice', 'bob', 'carol']) await f.service.toggleEntry(record.message, { ...actor, userId });
    f.members.delete('guild:bob');
    f.members.set('guild:carol', member('carol', { bot: true }));
    const ended = await f.service.end(record.message, host);
    assert.deepEqual(ended.winners, ['alice']);
    assert.equal(ended.entry.length, 3, 'entry history survives departures');
    f.members.set('guild:bob', member('bob'));
    const rerolled = await f.service.reroll(record.message, host);
    assert.deepEqual(rerolled.winners, ['alice', 'bob']);
    await f.service.stop();
});

test('no entries is a persisted completed result and active rerolls are rejected', async () => {
    const f = setup();
    const record = await f.service.create(input);
    await assert.rejects(f.service.reroll(record.message, host), userError(/End this giveaway/));
    assert.deepEqual((await f.service.end(record.message, host)).winners, []);
    assert.equal((await f.store.get(record.message))?.completed, true);
    await assert.rejects(f.service.toggleEntry(record.message, actor), userError(/ended/));
    await assert.rejects(f.service.end(record.message, host), userError(/already ended/));
    await assert.rejects(f.service.toggleEntry('missing', actor), userError(/not found/));
    await f.service.stop();
});

test('legacy active records report missing mapping and backfill verified interaction location', async () => {
    const f = setup();
    await f.store.insert(oldRecord());
    const issues = await f.service.start();
    assert.equal(issues[0]?.code, 'missing-location');
    assert.ok(issues[0]?.error instanceof GiveawayUserError);
    assert.match(String(issues[0]?.error), /legacyLocations/);
    assert.equal((await f.store.get('old'))?.guildId, undefined);
    await f.service.toggleEntry('old', actor);
    assert.equal((await f.store.get('old'))?.guildId, 'guild');
    assert.deepEqual((await f.store.get('old'))?.embeds, { legacy: true });
    assert.equal(f.scheduler.tasks.size, 1);
    await f.service.stop();
});

test('mapping is verified before legacy location is saved; wrong interaction location is refused', async () => {
    const f = setup({ legacyLocations: { old: location } });
    await f.store.insert(oldRecord());
    f.state.verified = false;
    assert.equal((await f.service.start())[0]?.code, 'recovery-failed');
    assert.ok(f.diagnostics[0]?.error instanceof GiveawayUserError);
    assert.equal((await f.store.get('old'))?.guildId, undefined);
    f.state.verified = true;
    await f.service.toggleEntry('old', actor);
    await assert.rejects(f.service.toggleEntry('old', { ...actor, channelId: 'wrong' }), userError(/location/));
    await f.service.stop();
});

test('legacy ended null timestamps are preserved and never restarted', async () => {
    const f = setup();
    await f.store.insert(oldRecord({ endTime: null }));
    assert.equal(isActiveGiveaway(oldRecord({ endTime: null })), false);
    assert.deepEqual(await f.service.start(), []);
    assert.equal(f.scheduler.tasks.size, 0);
    assert.equal(f.published.length, 0);
    assert.ok(await f.store.get('old'));
    await f.service.stop();
});

test('startup resumes future records and completes overdue mapped records immediately', async () => {
    const f = setup({ legacyLocations: { old: location, overdue: location } });
    await f.store.insert(oldRecord());
    await f.store.insert(oldRecord({ message: 'overdue', endTime: '500' }));
    assert.deepEqual(await f.service.start(), []);
    assert.equal(f.scheduler.tasks.size, 1);
    assert.equal((await f.store.get('overdue'))?.completed, true);
    f.state.time = 2000;
    f.scheduler.fire();
    await f.service.stop();
    assert.equal((await f.store.get('old'))?.completed, true);
    assert.equal(f.scheduler.tasks.size, 0);
});

test('long timers reschedule instead of ending early', async () => {
    const f = setup();
    const record = await f.service.create({ ...input, durationMs: 3_000_000_000 });
    assert.equal([...f.scheduler.tasks.values()][0]?.delay, 2_147_483_647);
    f.scheduler.fire();
    // Queue a same-message operation as an observable barrier for the timer task.
    await f.service.toggleEntry(record.message, actor);
    assert.equal((await f.store.get(record.message))?.completed, false);
    assert.equal(f.scheduler.tasks.size, 1);
    await f.service.stop();
});

test('send and insert failures never publish a successful giveaway; orphan cleanup is reported', async () => {
    const f = setup();
    f.state.createFailure = true;
    await assert.rejects(f.service.create(input), infrastructureError(/send failed/));
    assert.equal(f.store.records.size, 0);
    f.state.createFailure = false;
    f.store.failInsert = true;
    await assert.rejects(f.service.create(input), infrastructureError(/insert failed/));
    assert.deepEqual(f.discarded, ['message-1']);
    f.state.cleanupFailure = true;
    await assert.rejects(f.service.create(input), infrastructureError(/insert failed/));
    assert.equal(f.diagnostics[0]?.code, 'cleanup-failed');
    assert.equal(f.published.length, 0);
    await f.service.stop();
});

test('save failures do not mutate stored entries and do not poison the per-message queue', async () => {
    const f = setup();
    const record = await f.service.create(input);
    f.store.failSave = true;
    await assert.rejects(f.service.toggleEntry(record.message, actor), infrastructureError(/save failed/));
    assert.equal((await f.store.get(record.message))?.entered, 0);
    f.store.failSave = false;
    const originalGet = f.store.get.bind(f.store);
    const databaseFailure = new Error('database connection unavailable');
    f.store.get = async () => { throw databaseFailure; };
    await assert.rejects(f.service.toggleEntry(record.message, actor), error => error === databaseFailure);
    assert.equal(databaseFailure instanceof GiveawayUserError, false);
    f.store.get = originalGet;
    assert.equal((await f.service.toggleEntry(record.message, actor)).entered, true);
    await f.service.stop();
});

test('publication failure persists winners for retry without falsely claiming completion', async () => {
    const f = setup();
    const record = await f.service.create(input);
    await f.service.toggleEntry(record.message, actor);
    f.state.publishFailure = true;
    await assert.rejects(f.service.end(record.message, host), infrastructureError(/publish failed/));
    const pending = await f.store.get(record.message);
    assert.equal(pending?.completed, true);
    assert.equal(pending?.pendingPublish, true);
    assert.deepEqual(pending?.winners, ['alice']);
    await assert.rejects(f.service.reroll(record.message, host), userError(/previous result/));
    f.state.publishFailure = false;
    assert.deepEqual((await f.service.end(record.message, host)).winners, ['alice']);
    assert.equal((await f.store.get(record.message))?.pendingPublish, false);
    await f.service.stop();
});

test('startup retries persisted completed publication, but never rerolls it', async () => {
    const f = setup();
    await f.store.insert(oldRecord({ ...location, completed: true, winners: ['alice'], pendingPublish: true }));
    await f.service.start();
    assert.deepEqual(f.published[0]?.winners, ['alice']);
    assert.equal(f.scheduler.tasks.size, 0);
    assert.equal((await f.store.get('old'))?.pendingPublish, false);
    await f.service.stop();
});

test('member-fetch failures abort selection instead of silently treating members as absent', async () => {
    const f = setup();
    const record = await f.service.create(input);
    await f.service.toggleEntry(record.message, actor);
    f.state.memberFailure = true;
    await assert.rejects(f.service.end(record.message, host), infrastructureError(/member fetch failed/));
    assert.equal((await f.store.get(record.message))?.completed, false);
    await f.service.stop();
});

test('timer rejection is contained and stop drains running tasks', async () => {
    const f = setup();
    const record = await f.service.create(input);
    f.state.time = 2000;
    f.state.publishFailure = true;
    f.scheduler.fire();
    await f.service.stop();
    assert.equal(f.diagnostics[0]?.code, 'timer-failed');
    assert.equal((await f.store.get(record.message))?.pendingPublish, true);
    await assert.rejects(f.service.create(input), userError(/stopped/));
    await assert.rejects(f.service.toggleEntry(record.message, actor), userError(/stopped/));
});

test('initial publish failure leaves a recoverable saved record and running timer', async () => {
    const f = setup();
    f.state.publishFailure = true;
    await assert.rejects(f.service.create(input), infrastructureError(/publish failed/));
    assert.equal((await f.store.get('message-1'))?.pendingPublish, true);
    assert.equal(f.scheduler.tasks.size, 1);
    f.state.publishFailure = false;
    await f.service.start();
    assert.equal((await f.store.get('message-1'))?.pendingPublish, false);
    await f.service.stop();
});

test('interaction acknowledgement precedes store I/O and only success is reported after persistence', async () => {
    const f = setup();
    const record = await f.service.create(input);
    const events: string[] = [];
    const originalGet = f.store.get.bind(f.store);
    f.store.get = async id => {
        assert.equal(events[0], 'ack');
        events.push('get');
        return originalGet(id);
    };
    const replies: string[] = [];
    const interaction: GiveawayButtonInteraction = {
        customId: 'enter_giveaway', guildId: location.guildId, channelId: location.channelId,
        user: { id: actor.userId }, message: { id: record.message },
        async deferReply() { events.push('ack'); },
        async editReply(options) { replies.push(options.content ?? ''); },
    };
    assert.equal(await handleGiveawayInteraction(interaction, f.service), true);
    assert.deepEqual(replies, ['You entered the giveaway.']);
    f.store.failSave = true;
    await handleGiveawayInteraction(interaction, f.service);
    assert.equal(replies[1], 'Giveaway operation did not complete. Please try again later.');
    f.store.failSave = false;
    await f.service.end(record.message, host);
    await handleGiveawayInteraction(interaction, f.service);
    assert.equal(replies[2], 'Giveaway operation did not complete: This giveaway has ended.');
    const ignored = { ...interaction, customId: 'different-feature' };
    const count = events.length;
    assert.equal(await handleGiveawayInteraction(ignored, f.service), false);
    assert.equal(events.length, count);
    await f.service.stop();
});

test('stop waits for outstanding persistence and then rejects further work', async () => {
    const f = setup();
    const record = await f.service.create(input);
    let release: () => void = () => { throw new Error('Persistence barrier was not initialized.'); };
    let reached: () => void = () => { throw new Error('Queue barrier was not initialized.'); };
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const enteredSave = new Promise<void>(resolve => { reached = resolve; });
    const originalSave = f.store.save.bind(f.store);
    f.store.save = async value => { reached(); await blocked; await originalSave(value); };
    const toggle = f.service.toggleEntry(record.message, actor);
    await enteredSave;
    let stopped = false;
    const stop = f.service.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    release();
    await toggle;
    await stop;
    assert.equal(stopped, true);
    assert.equal(f.scheduler.tasks.size, 0);
    await assert.rejects(f.service.start(), userError(/stopped/));
});
