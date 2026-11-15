import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PermissionFlagsBits } from 'discord.js';
import { drainChannelLocks, MEMBER, planOverwrites, ROLE, VIEW, viewOf, withChannelLock } from '../src/features/channel-manager/channel-permissions';
import type { ChannelState, PermissionChannel, PlannedOverwrite, ViewSnapshot } from '../src/features/channel-manager/types';

const SEND = PermissionFlagsBits.SendMessages;
const REACTIONS = PermissionFlagsBits.AddReactions;
const owner = '111111111111111111';
const member = '222222222222222222';
const allowed = '333333333333333333';
const blocked = '444444444444444444';
const bot = '777777777777777777';
const guild = '888888888888888888';
const role = '101010101010101010';
const locked: ChannelState = { locked: true, whitelist: [], blacklist: [] };

function channel(overwrites: PlannedOverwrite[] = []): PermissionChannel {
    return {
        id: '999999999999999999',
        guild: { id: guild, roles: { everyone: { id: guild } } },
        permissionOverwrites: {
            cache: new Map(overwrites.map((entry) => [`${entry.type}:${entry.id}`, entry])),
            async set() { throw new Error('Pure planner must not write Discord permissions'); },
        },
    };
}

function planView(overwrites: readonly PlannedOverwrite[], id: string, type: typeof ROLE | typeof MEMBER): number {
    const entry = overwrites.find((overwrite) => overwrite.id === id && overwrite.type === type);
    return entry ? viewOf(entry.allow, entry.deny) : 0;
}

test('viewOf uses deny-over-allow precedence and ignores unrelated bits', () => {
    assert.equal(viewOf(VIEW, 0n), 1);
    assert.equal(viewOf(0n, VIEW), -1);
    assert.equal(viewOf(VIEW, VIEW), -1);
    assert.equal(viewOf(SEND, SEND), 0);
});

test('lock masks existing allows, preserves unrelated bits, and gives blacklist precedence', () => {
    const input = [
        { id: role, type: ROLE, allow: VIEW | SEND, deny: 0n },
        { id: member, type: MEMBER, allow: VIEW | REACTIONS, deny: 0n },
        { id: allowed, type: MEMBER, allow: VIEW, deny: 0n },
        { id: blocked, type: MEMBER, allow: VIEW, deny: 0n },
        { id: owner, type: MEMBER, allow: VIEW, deny: 0n },
    ];
    const source = channel(input);
    const plan = planOverwrites(source, { userId: owner }, {
        locked: true,
        whitelist: [allowed, blocked, allowed, owner, bot],
        blacklist: [blocked, blocked, owner, bot],
    }, bot);
    assert.equal(planView(plan.overwrites, guild, ROLE), -1);
    assert.equal(planView(plan.overwrites, owner, MEMBER), 1);
    assert.equal(planView(plan.overwrites, bot, MEMBER), 1);
    assert.equal(planView(plan.overwrites, allowed, MEMBER), 1);
    assert.equal(planView(plan.overwrites, blocked, MEMBER), -1);
    assert.equal(planView(plan.overwrites, role, ROLE), 0);
    assert.equal(planView(plan.overwrites, member, MEMBER), 0);
    assert.equal(plan.overwrites.find((entry) => entry.id === role)?.allow, SEND);
    assert.equal(plan.overwrites.find((entry) => entry.id === member)?.allow, REACTIONS);
    assert.deepEqual(plan.whitelist, [allowed]);
    assert.deepEqual(plan.blacklist, [blocked]);
    assert.deepEqual(plan.overwrites, [...plan.overwrites].sort((a, b) => a.type - b.type || a.id.localeCompare(b.id)));
    assert.deepEqual([...source.permissionOverwrites.cache.values()], input, 'planning leaves live input untouched');
});

test('unlock restores first-seen views and private everyone while preserving current unrelated bits', () => {
    const original = channel([
        { id: guild, type: ROLE, allow: 0n, deny: VIEW | SEND },
        { id: role, type: ROLE, allow: VIEW | SEND, deny: 0n },
        { id: member, type: MEMBER, allow: VIEW, deny: SEND },
    ]);
    const lock = planOverwrites(original, { userId: owner }, locked, bot);
    const live = lock.overwrites.map((entry) => entry.id === member ? { ...entry, deny: entry.deny | REACTIONS } : entry);
    const unlock = planOverwrites(channel(live), { userId: owner, viewSnapshots: lock.snapshots }, { ...locked, locked: false }, bot);
    assert.equal(planView(unlock.overwrites, guild, ROLE), -1);
    assert.equal(planView(unlock.overwrites, role, ROLE), 1);
    assert.equal(planView(unlock.overwrites, member, MEMBER), 1);
    assert.equal(unlock.overwrites.find((entry) => entry.id === guild)?.deny, VIEW | SEND);
    assert.equal(unlock.overwrites.find((entry) => entry.id === role)?.allow, VIEW | SEND);
    assert.equal(unlock.overwrites.find((entry) => entry.id === member)?.deny, SEND | REACTIONS);
    assert.equal(unlock.overwrites.some((entry) => entry.id === owner || entry.id === bot), false);
    assert.deepEqual(unlock.snapshots, []);
});

test('unlock removes feature-created public-channel overlays without residue', () => {
    const lock = planOverwrites(channel(), { userId: owner }, locked, bot);
    assert.equal(lock.overwrites.length, 3);
    const unlock = planOverwrites(channel(lock.overwrites), { userId: owner, viewSnapshots: lock.snapshots }, { ...locked, locked: false }, bot);
    assert.deepEqual(unlock.overwrites, []);
    assert.deepEqual(unlock.snapshots, []);
});

test('list removal while locked keeps the original allow masked until unlock', () => {
    const baseline: ViewSnapshot[] = [{ id: member, type: MEMBER, view: 1 }];
    const removed = planOverwrites(channel([{ id: member, type: MEMBER, allow: VIEW, deny: SEND }]), {
        userId: owner, viewSnapshots: baseline,
    }, locked, bot);
    assert.equal(planView(removed.overwrites, member, MEMBER), 0);
    assert.deepEqual(removed.snapshots.find((entry) => entry.id === member), baseline[0]);
    const unlock = planOverwrites(channel(removed.overwrites), { userId: owner, viewSnapshots: removed.snapshots }, { ...locked, locked: false }, bot);
    assert.equal(planView(unlock.overwrites, member, MEMBER), 1);
});

test('withChannelLock serialises one channel, is reentrant, and recovers after failure', async () => {
    const order: string[] = [];
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const first = withChannelLock('serial-channel', async () => {
        order.push('first-start');
        started.resolve();
        await gate.promise;
        order.push('first-end');
        return 'first';
    });
    await started.promise;
    const second = withChannelLock('serial-channel', async () => {
        order.push('second');
        return 'second';
    });
    assert.equal(await withChannelLock('independent-channel', async () => 'independent'), 'independent');
    gate.resolve();
    assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);
    assert.equal(await withChannelLock('nested-channel', () => withChannelLock('nested-channel', async () => 42)), 42);
    await assert.rejects(withChannelLock('failed-channel', async () => { throw new Error('task exploded'); }), /task exploded/);
    assert.equal(await withChannelLock('failed-channel', async () => 'recovered'), 'recovered');
});

test('draining waits for all queued channel work, including queued successors', async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const order: string[] = [];
    const first = withChannelLock('drain-channel', async () => {
        started.resolve();
        await gate.promise;
        order.push('first');
    });
    await started.promise;
    const second = withChannelLock('drain-channel', async () => { order.push('second'); });
    const draining = drainChannelLocks().then(() => { order.push('drained'); });
    assert.deepEqual(order, []);
    gate.resolve();
    await Promise.all([first, second, draining]);
    assert.deepEqual(order, ['first', 'second', 'drained']);
});
