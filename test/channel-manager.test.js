'use strict';

/**
 * Regression tests for the Channel Manager feature.
 *
 * Run with: node --test test/channel-manager.test.js
 * No network, token, or real database access. The model is replaced through
 * require.cache at its exact path; discord.js itself (Collection, enums) is
 * the real installed dependency.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    Collection,
    ChannelType,
    OverwriteType,
    PermissionFlagsBits,
} = require('discord.js');

const VIEW = PermissionFlagsBits.ViewChannel;
const SEND = PermissionFlagsBits.SendMessages;
const REACTIONS = PermissionFlagsBits.AddReactions;
const MANAGE_ROLES = PermissionFlagsBits.ManageRoles;
const MANAGE_CHANNELS = PermissionFlagsBits.ManageChannels;
const ADMIN = PermissionFlagsBits.Administrator;
const ROLE = OverwriteType.Role;
const MEMBER = OverwriteType.Member;

// ---------------------------------------------------------------------------
// Model double, installed before anything requires the real model.
// ---------------------------------------------------------------------------

const MODEL_PATH = require.resolve('../models/OwnedChannel');

const state = {
    docs: [],
    nextId: 0,
    queryCount: 0,
    createCount: 0,
    saveCount: 0,
    deleteCount: 0,
    fetchCount: 0,
    createError: null,
    findError: null,
    saveError: null,
};

function resetState() {
    state.docs = [];
    state.nextId = 0;
    state.queryCount = 0;
    state.createCount = 0;
    state.saveCount = 0;
    state.deleteCount = 0;
    state.fetchCount = 0;
    state.createError = null;
    state.findError = null;
    state.saveError = null;
}

function matches(doc, filter) {
    return Object.entries(filter || {}).every(([key, value]) => String(doc[key]) === String(value));
}

function makeStoredDoc(data) {
    const doc = {
        _id: data._id || `doc-${++state.nextId}`,
        userId: String(data.userId),
        guildId: String(data.guildId),
        channelId: String(data.channelId),
        locked: Boolean(data.locked),
        whitelist: Array.isArray(data.whitelist) ? [...data.whitelist] : [],
        blacklist: Array.isArray(data.blacklist) ? [...data.blacklist] : [],
        viewSnapshots: Array.isArray(data.viewSnapshots) ? data.viewSnapshots.map((entry) => ({ ...entry })) : [],
    };
    doc.save = async function save() {
        state.saveCount += 1;
        if (state.saveError) throw state.saveError;
        return doc;
    };
    return doc;
}

const model = {
    db: { readyState: 1 },
    findOne(filter) {
        return {
            exec: async () => {
                state.queryCount += 1;
                if (state.findError) throw state.findError;
                return state.docs.find((doc) => matches(doc, filter)) || null;
            },
        };
    },
    async create(data) {
        state.createCount += 1;
        if (state.createError) throw state.createError;
        if (state.docs.some((doc) => doc.userId === String(data.userId))) {
            const error = new Error('E11000 duplicate key');
            error.code = 11000;
            error.keyPattern = { userId: 1 };
            throw error;
        }
        if (state.docs.some((doc) => doc.channelId === String(data.channelId))) {
            const error = new Error('E11000 duplicate key');
            error.code = 11000;
            error.keyPattern = { channelId: 1 };
            throw error;
        }
        const doc = makeStoredDoc(data);
        state.docs.push(doc);
        return doc;
    },
    deleteOne(filter) {
        return {
            exec: async () => {
                state.deleteCount += 1;
                const index = state.docs.findIndex((doc) => matches(doc, filter));
                if (index !== -1) state.docs.splice(index, 1);
                return { deletedCount: index === -1 ? 0 : 1 };
            },
        };
    },
};

require.cache[MODEL_PATH] = {
    id: MODEL_PATH,
    filename: MODEL_PATH,
    loaded: true,
    exports: model,
};

const channelManager = require('../utils/channelManager');
const {
    applyChannelState,
    planOverwrites,
    withChannelLock,
    viewOf,
} = require('../utils/channelPermissions');
const claim = require('../commands/Channel Manager/claim.js');
const lock = require('../commands/Channel Manager/lock.js');
const unlock = require('../commands/Channel Manager/unlock.js');
const whitelist = require('../commands/Channel Manager/whitelist.js');
const blacklist = require('../commands/Channel Manager/blacklist.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const U1 = '111111111111111111';
const U2 = '222222222222222222';
const U3 = '333333333333333333';
const U4 = '444444444444444444';
const ADMIN_USER = '555555555555555555';
const OWNER_USER = '666666666666666666';
const BOT = '777777777777777777';
const G1 = '888888888888888888';
const C1 = '999999999999999999';
const OTHER_GUILD = '121212121212121212';
const OTHER_CHANNEL = '131313131313131313';

class FakeEmbedBuilder {
    constructor() {
        this.data = { title: '', fields: [], color: null, footer: null, timestamp: null };
    }
    setTitle(value) { this.data.title = value; return this; }
    addFields(...fields) { this.data.fields.push(...fields.flat()); return this; }
    setColor(value) { this.data.color = value; return this; }
    setFooter(value) { this.data.footer = value; return this; }
    setTimestamp(value) { this.data.timestamp = value; return this; }
}

function makeChannel(overwrites = []) {
    const channel = {
        id: C1,
        name: 'test-channel',
        type: ChannelType.GuildText,
        guild: null,
        setCalls: [],
        setCallCount: 0,
        failSetCalls: new Set(),
        isThread: () => false,
        permissionOverwrites: null,
    };
    const cache = new Collection();
    channel.permissionOverwrites = {
        cache,
        set: async (list, reason) => {
            channel.setCallCount += 1;
            channel.setCalls.push({
                list: list.map((entry) => ({
                    id: String(entry.id),
                    type: Number(entry.type),
                    allow: BigInt(entry.allow),
                    deny: BigInt(entry.deny),
                })),
                reason,
            });
            if (channel.failSetCalls.has(channel.setCallCount)) {
                const error = new Error('Missing Permissions');
                error.code = 50013;
                throw error;
            }
            channel.permissionOverwrites.cache = new Collection(list.map((entry) => [
                `${entry.id}:${entry.type}`,
                {
                    id: String(entry.id),
                    type: Number(entry.type),
                    allow: BigInt(entry.allow),
                    deny: BigInt(entry.deny),
                },
            ]));
        },
    };
    for (const overwrite of overwrites) seedOverwrite(channel, overwrite);
    return channel;
}

function seedOverwrite(channel, { id, type, allow = 0n, deny = 0n }) {
    channel.permissionOverwrites.cache.set(`${id}:${type}`, {
        id: String(id),
        type: Number(type),
        allow: BigInt(allow),
        deny: BigInt(deny),
    });
}

function fresh() {
    resetState();
    model.db.readyState = 1;

    const channel = makeChannel();
    const guild = {
        id: G1,
        ownerId: OWNER_USER,
        roles: { everyone: { id: G1 } },
        members: {
            cache: new Collection(),
            me: null,
            fetchMe: async () => env.botMember,
            fetch: async (arg) => {
                state.fetchCount += 1;
                if (arg && typeof arg === 'object') {
                    const query = String(arg.query || '').toLowerCase();
                    const found = [...guild.members.cache.values()]
                        .filter((member) => String(member.user.username).toLowerCase().startsWith(query))
                        .slice(0, arg.limit || 10);
                    return new Collection(found.map((member) => [member.id, member]));
                }
                const member = env.membersById.get(String(arg));
                if (member) return member;
                const error = new Error('Unknown Member');
                error.code = 10007;
                throw error;
            },
        },
    };
    channel.guild = guild;

    const client = {
        user: { id: BOT, username: 'smol-maiden' },
        config: {
            ownerID: OWNER_USER,
            embedColor: '#2f3136',
            embedFooterText1: 'Smol Maiden',
        },
        discord: { EmbedBuilder: FakeEmbedBuilder },
    };

    const env = {
        channel,
        guild,
        client,
        membersById: new Map(),
        botPermissions: new Set([VIEW, SEND, MANAGE_ROLES, MANAGE_CHANNELS]),
        botMember: null,
    };

    env.botMember = {
        id: BOT,
        user: { username: 'smol-maiden' },
        permissions: { has: () => false },
        permissionsIn: () => ({ has: (bit) => env.botPermissions.has(bit) }),
    };
    guild.members.me = env.botMember;

    env.addMember = (id, username, options = {}) => {
        const member = {
            id: String(id),
            user: {
                username,
                displayName: options.displayName || username,
                globalName: options.displayName || username,
            },
            permissions: {
                has: (bit) => Boolean(options.admin) && bit === ADMIN,
            },
        };
        env.membersById.set(String(id), member);
        guild.members.cache.set(String(id), member);
        return member;
    };

    env.addDoc = (overrides = {}) => {
        const doc = makeStoredDoc({
            userId: U1,
            guildId: G1,
            channelId: C1,
            locked: false,
            whitelist: [],
            blacklist: [],
            viewSnapshots: [],
            ...overrides,
        });
        state.docs.push(doc);
        return doc;
    };

    env.message = (userId, options = {}) => {
        const replies = [];
        const member = {
            id: String(userId),
            user: { username: options.username || 'tester' },
            permissions: {
                has: (bit) => Boolean(options.admin) && bit === ADMIN,
            },
            permissionsIn: options.permissionsIn === false
                ? undefined
                : () => ({
                    has: (bit) => Boolean(options.manageChannels !== false) && bit === MANAGE_CHANNELS,
                }),
        };
        const message = {
            author: { id: String(userId), username: options.username || 'tester' },
            member,
            channel,
            guild,
            client,
            replies,
            reply: async (payload) => {
                replies.push(payload);
                return payload;
            },
        };
        return message;
    };

    return env;
}

function overwriteAt(channel, id, type) {
    return channel.permissionOverwrites.cache.get(`${id}:${type}`) || null;
}

function viewAt(channel, id, type) {
    const overwrite = overwriteAt(channel, id, type);
    return overwrite ? viewOf(overwrite.allow, overwrite.deny) : 0;
}

function snapshotsOf(channel) {
    return [...channel.permissionOverwrites.cache.values()]
        .map((entry) => ({
            id: String(entry.id),
            type: Number(entry.type),
            allow: BigInt(entry.allow),
            deny: BigInt(entry.deny),
        }))
        .sort((a, b) => (a.type - b.type) || a.id.localeCompare(b.id));
}

function planView(overwrites, id, type) {
    const entry = overwrites.find((item) => String(item.id) === String(id) && item.type === type);
    return entry ? viewOf(entry.allow, entry.deny) : 0;
}

function textOf(message) {
    const parts = [];
    for (const payload of message.replies) {
        if (payload.content) parts.push(payload.content);
        for (const embed of payload.embeds || []) {
            if (embed.data && embed.data.title) parts.push(embed.data.title);
            for (const field of (embed.data && embed.data.fields) || []) {
                if (field.name) parts.push(field.name);
                if (field.value) parts.push(field.value);
            }
        }
    }
    return parts.join('\n');
}

function lastText(message) {
    const payload = message.replies[message.replies.length - 1];
    return textOf({ replies: [payload] });
}

function muteExpectedErrors(t) {
    const original = console.error;
    console.error = () => {};
    t.after(() => { console.error = original; });
}

function lockState(env, overrides = {}) {
    return {
        locked: true,
        whitelist: [],
        blacklist: [],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Pure planning: masking, precedence, snapshots, ordering
// ---------------------------------------------------------------------------

test('viewOf uses deny-over-allow precedence and ignores unrelated bits', () => {
    assert.equal(viewOf(VIEW, 0n), 1);
    assert.equal(viewOf(0n, VIEW), -1);
    assert.equal(viewOf(VIEW, VIEW), -1, 'deny wins when both bits are present');
    assert.equal(viewOf(SEND, SEND), 0, 'unrelated bits do not imply view');
});

test('lock masks pre-existing role/member ViewChannel allows, keeps owner/bot/whitelist and preserved bits', () => {
    const env = fresh();
    seedOverwrite(env.channel, { id: '101010101010101010', type: ROLE, allow: VIEW | SEND });
    seedOverwrite(env.channel, { id: U2, type: MEMBER, allow: VIEW | REACTIONS });
    seedOverwrite(env.channel, { id: U3, type: MEMBER, allow: VIEW });
    seedOverwrite(env.channel, { id: U4, type: MEMBER, allow: VIEW });
    seedOverwrite(env.channel, { id: U1, type: MEMBER, allow: VIEW });
    const doc = env.addDoc();

    const plan = planOverwrites(env.channel, doc, lockState(env, {
        whitelist: [U3, U4, U3, U1, BOT],
        blacklist: [U4],
    }), BOT);

    assert.equal(planView(plan.overwrites, G1, ROLE), -1, '@everyone is denied while locked');
    assert.equal(planView(plan.overwrites, U1, MEMBER), 1, 'owner keeps explicit view');
    assert.equal(planView(plan.overwrites, BOT, MEMBER), 1, 'bot keeps explicit view');
    assert.equal(planView(plan.overwrites, U3, MEMBER), 1, 'whitelist keeps explicit view');
    assert.equal(planView(plan.overwrites, U4, MEMBER), -1, 'blacklist wins over a prior allow and whitelist entry');

    const role = plan.overwrites.find((entry) => entry.id === '101010101010101010' && entry.type === ROLE);
    assert.ok(role, 'pre-existing role overwrite is retained');
    assert.equal(role.allow & VIEW, 0n, 'role ViewChannel allow is masked');
    assert.equal(role.allow & SEND, SEND, 'unrelated role send allow is preserved');

    const member = plan.overwrites.find((entry) => entry.id === U2 && entry.type === MEMBER);
    assert.ok(member, 'pre-existing member overwrite is retained');
    assert.equal(member.allow & VIEW, 0n, 'member ViewChannel allow is masked');
    assert.equal(member.allow & REACTIONS, REACTIONS, 'unrelated member allow is preserved');

    const blocked = plan.overwrites.find((entry) => entry.id === U4 && entry.type === MEMBER);
    assert.ok(blocked, 'blacklisted member has an overwrite');
    assert.equal(blocked.deny & VIEW, VIEW, 'blacklisted member is denied view');

    assert.deepEqual(plan.whitelist, [U3], 'owner/bot/blacklisted entries are not whitelist entries');
    assert.deepEqual(plan.blacklist, [U4], 'blacklist is de-duplicated');

    const keys = plan.overwrites.map((entry) => `${entry.type}:${entry.id}`);
    const sorted = [...keys].sort((a, b) => {
        const [typeA, idA] = a.split(':');
        const [typeB, idB] = b.split(':');
        return (Number(typeA) - Number(typeB)) || idA.localeCompare(idB);
    });
    assert.deepEqual(keys, sorted, 'overwrite list is serialised in role-then-member id order');
});

test('apply lock then unlock restores original views and unrelated send deny; private everyone deny survives', async () => {
    const env = fresh();
    seedOverwrite(env.channel, { id: G1, type: ROLE, deny: VIEW | SEND });
    seedOverwrite(env.channel, { id: '101010101010101010', type: ROLE, allow: VIEW | SEND });
    seedOverwrite(env.channel, { id: U2, type: MEMBER, allow: VIEW, deny: SEND });
    const doc = env.addDoc();

    const locked = await applyChannelState(env.channel, doc, lockState(env), BOT, 'test lock');
    assert.equal(locked.ok, true);
    assert.equal(locked.changed, true);
    assert.equal(locked.state.locked, true);
    assert.equal(doc.locked, true);
    assert.equal(viewAt(env.channel, G1, ROLE), -1, 'private everyone deny remains while locked');
    assert.equal(viewAt(env.channel, '101010101010101010', ROLE), 0, 'role ViewChannel allow is masked while locked');
    assert.equal(viewAt(env.channel, U2, MEMBER), 0, 'member ViewChannel allow is masked while locked');
    assert.equal(viewAt(env.channel, U1, MEMBER), 1);
    assert.equal(viewAt(env.channel, BOT, MEMBER), 1);

    const unlocked = await applyChannelState(env.channel, doc, lockState(env, { locked: false }), BOT, 'test unlock');
    assert.equal(unlocked.ok, true);
    assert.equal(unlocked.changed, true);
    assert.equal(doc.locked, false);
    assert.equal(viewAt(env.channel, G1, ROLE), -1, 'original private everyone deny is restored');
    const everyone = overwriteAt(env.channel, G1, ROLE);
    assert.equal(everyone.deny & SEND, SEND, 'original everyone send deny is kept');

    const role = overwriteAt(env.channel, '101010101010101010', ROLE);
    assert.equal(viewOf(role.allow, role.deny), 1, 'original role view allow is restored');
    assert.equal(role.allow & SEND, SEND, 'unrelated role send allow survives unlock');

    const member = overwriteAt(env.channel, U2, MEMBER);
    assert.equal(viewOf(member.allow, member.deny), 1, 'original member view allow is restored');
    assert.equal(member.deny & SEND, SEND, 'unrelated member send deny survives unlock');

    assert.equal(overwriteAt(env.channel, U1, MEMBER), null, 'feature-created owner allow is removed');
    assert.equal(overwriteAt(env.channel, BOT, MEMBER), null, 'feature-created bot allow is removed');
    assert.deepEqual(doc.viewSnapshots, [], 'snapshots are cleared once restore is complete');
});

test('unlock removes feature-created public everyones deny and leaves a clean channel', async () => {
    const env = fresh();
    const doc = env.addDoc();

    const locked = await applyChannelState(env.channel, doc, lockState(env), BOT);
    assert.equal(locked.ok, true);
    assert.equal(env.channel.permissionOverwrites.cache.size, 3, 'everyone/owner/bot overlays exist while locked');

    const unlocked = await applyChannelState(env.channel, doc, lockState(env, { locked: false }), BOT);
    assert.equal(unlocked.ok, true);
    assert.equal(unlocked.changed, true);
    assert.equal(env.channel.permissionOverwrites.cache.size, 0, 'unlock leaves no residue on a public channel');
    assert.deepEqual(doc.viewSnapshots, []);
});

// ---------------------------------------------------------------------------
// Failure handling and rollback
// ---------------------------------------------------------------------------

test('save failure after Discord update rolls permissions back and restores the document', async (t) => {
    muteExpectedErrors(t);
    const env = fresh();
    seedOverwrite(env.channel, { id: U2, type: MEMBER, allow: VIEW, deny: SEND });
    seedOverwrite(env.channel, { id: G1, type: ROLE, deny: VIEW | SEND });
    const doc = env.addDoc({ locked: false, whitelist: [U3], blacklist: [U4], viewSnapshots: [{ id: U3, type: MEMBER, view: 0 }] });
    const before = snapshotsOf(env.channel);
    const beforeDoc = {
        locked: doc.locked,
        whitelist: [...doc.whitelist],
        blacklist: [...doc.blacklist],
        viewSnapshots: doc.viewSnapshots.map((entry) => ({ ...entry })),
    };
    state.saveError = new Error('database unavailable');

    const result = await applyChannelState(env.channel, doc, lockState(env, { whitelist: [U3], blacklist: [U4] }), BOT);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'SAVE_FAILED');
    assert.equal(result.rolledBack, true);
    assert.equal(result.needsReconciliation, undefined);
    assert.equal(state.saveCount, 1);
    assert.equal(env.channel.setCallCount, 2, 'the live update and the rollback set are both attempted');
    assert.match(env.channel.setCalls[1].reason, /rollback/i);
    assert.deepEqual(
        env.channel.setCalls[1].list.slice().sort((a, b) => (a.type - b.type) || a.id.localeCompare(b.id)),
        before,
        'rollback writes the exact previous overwrite list',
    );
    assert.deepEqual(snapshotsOf(env.channel), before, 'channel cache is back to its previous state');
    assert.deepEqual(
        {
            locked: doc.locked,
            whitelist: doc.whitelist,
            blacklist: doc.blacklist,
            viewSnapshots: doc.viewSnapshots,
        },
        beforeDoc,
        'document fields are restored after the failed save',
    );
});

test('rollback failure reports SAVE_FAILED_ROLLBACK_FAILED with reconciliation flag', async (t) => {
    muteExpectedErrors(t);
    const env = fresh();
    const doc = env.addDoc();
    const before = snapshotsOf(env.channel);
    state.saveError = new Error('database unavailable');
    env.channel.failSetCalls.add(2);

    const result = await applyChannelState(env.channel, doc, lockState(env), BOT);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'SAVE_FAILED_ROLLBACK_FAILED');
    assert.equal(result.rolledBack, false);
    assert.equal(result.needsReconciliation, true);
    assert.ok(result.error instanceof Error);
    assert.ok(result.rollbackError instanceof Error);
    assert.equal(env.channel.setCallCount, 2);
    assert.equal(doc.locked, false, 'document still reports the pre-apply state');
    assert.notDeepEqual(snapshotsOf(env.channel), before, 'a failed rollback leaves Discord in the updated state');
});

test('Discord update failure does not persist state or report success (command level)', async (t) => {
    muteExpectedErrors(t);
    const env = fresh();
    const doc = env.addDoc();
    env.channel.failSetCalls.add(1);
    const message = env.message(U1);

    await lock.run(env.client, message, []);

    const text = textOf(message);
    assert.match(text, /Discord rejected the permission update/);
    assert.doesNotMatch(text, /Success/);
    assert.doesNotMatch(text, /Locked/);
    assert.equal(env.channel.setCallCount, 1);
    assert.equal(state.saveCount, 0, 'no document save is attempted after a failed live update');
    assert.equal(doc.locked, false);
    assert.deepEqual(doc.viewSnapshots, []);
    assert.equal(env.channel.permissionOverwrites.cache.size, 0, 'channel permissions were never changed');
});

test('Discord update failure returns DISCORD_UPDATE_FAILED and restores the document', async () => {
    const env = fresh();
    const doc = env.addDoc({ locked: false, whitelist: [U3], blacklist: [] });
    env.channel.failSetCalls.add(1);

    const result = await applyChannelState(env.channel, doc, lockState(env, { whitelist: [U3] }), BOT);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'DISCORD_UPDATE_FAILED');
    assert.equal(state.saveCount, 0);
    assert.equal(doc.locked, false);
    assert.deepEqual(doc.whitelist, [U3]);
    assert.deepEqual(doc.viewSnapshots, []);
});

test('save failure with no live change reports SAVE_FAILED without a rollback write', async (t) => {
    muteExpectedErrors(t);
    const env = fresh();
    const doc = env.addDoc();
    // Pre-seed the exact locked state so the desired plan is a no-op.
    await applyChannelState(env.channel, doc, lockState(env), BOT);
    state.saveCount = 0;
    state.saveError = new Error('database unavailable');

    const result = await applyChannelState(env.channel, doc, lockState(env), BOT);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'SAVE_FAILED');
    assert.equal(result.rolledBack, true);
    assert.equal(env.channel.setCallCount, 1, 'only the earlier successful set happened');
    assert.equal(doc.locked, true, 'document is restored to the state before this call');
});

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

test('withChannelLock serialises the same channel, is re-entrant, and recovers after failure', async () => {
    const order = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let startedResolve;
    const started = new Promise((resolve) => { startedResolve = resolve; });

    const first = withChannelLock(C1, async () => {
        order.push('first-start');
        startedResolve();
        await gate;
        order.push('first-end');
        return 'first';
    });
    await started;
    const second = withChannelLock(C1, async () => {
        order.push('second');
        return 'second';
    });
    release();
    const results = await Promise.all([first, second]);

    assert.deepEqual(results, ['first', 'second']);
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);

    const nested = await withChannelLock(C1, () => withChannelLock(C1, async () => 42));
    assert.equal(nested, 42, 're-entrant acquisition on the same channel does not deadlock');

    await assert.rejects(
        withChannelLock('failing-channel', async () => { throw new Error('task exploded'); }),
        /task exploded/,
    );
    await assert.doesNotReject(async () => {
        const value = await withChannelLock('failing-channel', async () => 'recovered');
        assert.equal(value, 'recovered');
    });
});

// ---------------------------------------------------------------------------
// Resolution, database readiness
// ---------------------------------------------------------------------------

test('resolveTarget resolves ids and mentions, keeps departed ids for removal, and requires members for adds', async () => {
    const env = fresh();
    const member = env.addMember(U2, 'bestie');
    const message = env.message(U1);

    const byId = await channelManager.resolveTarget(message, U2, { requireMember: true });
    assert.equal(byId.id, U2);
    assert.equal(byId.member, member);

    const byMention = await channelManager.resolveTarget(message, `<@${U2}>`, { requireMember: true });
    assert.equal(byMention.id, U2);
    assert.equal(byMention.member, member);

    const byNickMention = await channelManager.resolveTarget(message, `<@!${U2}>`, { requireMember: true });
    assert.equal(byNickMention.id, U2);
    assert.equal(byNickMention.member, member);

    env.membersById.delete(U2);
    env.guild.members.cache.delete(U2);
    const departed = await channelManager.resolveTarget(message, U2, { requireMember: false, knownIds: [U2] });
    assert.equal(departed.id, U2);
    assert.equal(departed.member, null);
    assert.equal(departed.error, undefined);

    const requiredButGone = await channelManager.resolveTarget(message, U2, { requireMember: true });
    assert.equal(requiredButGone.id, U2);
    assert.equal(requiredButGone.error, 'notmember');
});

test('username matching is exact and case-insensitive, never displayName or partial', async () => {
    const env = fresh();
    env.addMember(U2, 'bestie', { displayName: 'trickster' });
    const message = env.message(U1);

    const exact = await channelManager.resolveTarget(message, 'BESTIE');
    assert.equal(exact.id, U2);

    const displayName = await channelManager.resolveTarget(message, 'trickster');
    assert.equal(displayName.error, 'notfound', 'displayName must not resolve');

    const partial = await channelManager.resolveTarget(message, 'best');
    assert.equal(partial.error, 'notfound', 'partial username must not resolve');
});

test('malformed mentions are rejected instead of treated as user ids', async () => {
    const env = fresh();
    const message = env.message(U1);
    // A permissive regex would call fetch('not-a-snowflake'). Make that lookup
    // succeed so accepting malformed text is detected, not hidden by a miss.
    env.guild.members.fetch = async (arg) => {
        if (arg && typeof arg === 'object') return new Collection();
        return { id: String(arg), user: { username: String(arg) } };
    };

    const badWord = await channelManager.resolveTarget(message, '<@not-a-snowflake>');
    assert.equal(badWord.error, 'notfound');
    assert.equal(badWord.id, undefined);

    const tooShort = await channelManager.resolveTarget(message, '<@123>');
    assert.equal(tooShort.error, 'notfound');
    assert.equal(tooShort.id, undefined);
});

test('Mongo disconnected fails fast without issuing a query', async () => {
    const env = fresh();
    env.addDoc();
    model.db.readyState = 0;

    assert.equal(channelManager.isDbReady(), false);
    const doc = await channelManager.getChannelDoc(C1);
    assert.equal(doc, null);
    assert.equal(state.queryCount, 0);

    const lockMessage = env.message(U1);
    await lock.run(env.client, lockMessage, []);
    assert.match(textOf(lockMessage), /registry is unavailable/);
    assert.equal(state.queryCount, 0);
    assert.equal(env.channel.setCallCount, 0);
    assert.equal(state.saveCount, 0);

    const claimMessage = env.message(U1);
    await claim.run(env.client, claimMessage, []);
    assert.match(textOf(claimMessage), /registry is unavailable/);
    assert.equal(state.queryCount, 0);
    assert.equal(state.createCount, 0);
});

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

test('claim requires caller channel-level ManageChannels, including for admins', async () => {
    const env = fresh();
    const noManage = env.message(U1, { manageChannels: false });
    await claim.run(env.client, noManage, []);
    assert.match(textOf(noManage), /Manage Channels/);
    assert.equal(state.createCount, 0);

    const adminNoManage = env.message(ADMIN_USER, { admin: true, manageChannels: false });
    await claim.run(env.client, adminNoManage, []);
    assert.match(textOf(adminNoManage), /Manage Channels/);
    assert.equal(state.createCount, 0);

    const noPermissionApi = env.message(U1, { permissionsIn: false });
    await claim.run(env.client, noPermissionApi, []);
    assert.match(textOf(noPermissionApi), /Manage Channels/);
    assert.equal(state.createCount, 0);
});

test('claim creates one channel with model defaults', async () => {
    const env = fresh();
    const message = env.message(U1, { manageChannels: true });

    await claim.run(env.client, message, []);

    assert.equal(state.createCount, 1);
    assert.equal(state.docs.length, 1);
    const doc = state.docs[0];
    assert.equal(doc.userId, U1);
    assert.equal(doc.guildId, G1);
    assert.equal(doc.channelId, C1);
    assert.equal(doc.locked, false);
    assert.deepEqual(doc.whitelist, []);
    assert.deepEqual(doc.blacklist, []);
    assert.deepEqual(doc.viewSnapshots, []);
    assert.match(textOf(message), /Channel claimed/i);
});

test('claim refuses threads and non-text channels', async () => {
    const env = fresh();
    env.channel.isThread = () => true;
    const threadMessage = env.message(U1);
    await claim.run(env.client, threadMessage, []);
    assert.match(textOf(threadMessage), /Threads cannot be claimed/);
    assert.equal(state.createCount, 0);
    assert.equal(state.queryCount, 0);

    env.channel.isThread = () => false;
    env.channel.type = ChannelType.GuildVoice;
    const voiceMessage = env.message(U1);
    await claim.run(env.client, voiceMessage, []);
    assert.match(textOf(voiceMessage), /Only regular text channels/);
    assert.equal(state.createCount, 0);
});

test('claim enforces one channel per user globally and one owner per channel', async () => {
    const env = fresh();
    env.addDoc({ userId: U1, guildId: OTHER_GUILD, channelId: OTHER_CHANNEL });
    const existingUser = env.message(U1);
    await claim.run(env.client, existingUser, []);
    assert.match(textOf(existingUser), /another server/);
    assert.equal(state.createCount, 0);
    assert.equal(state.docs.length, 1);

    const env2 = fresh();
    env2.addDoc({ userId: U3, guildId: G1, channelId: C1 });
    const existingChannel = env2.message(U1);
    await claim.run(env2.client, existingChannel, []);
    assert.match(textOf(existingChannel), /already owned by/);
    assert.equal(state.createCount, 0);
    assert.equal(state.docs.length, 1);
});

test('claim cleans up a stale registry entry when the old channel is confirmed deleted', async () => {
    const env = fresh();
    env.addDoc({ userId: U1, guildId: G1, channelId: OTHER_CHANNEL });
    env.guild.channels = {
        fetch: async (id) => {
            assert.equal(String(id), OTHER_CHANNEL);
            const error = new Error('Unknown Channel');
            error.code = 10003;
            throw error;
        },
    };
    const message = env.message(U1);

    await claim.run(env.client, message, []);

    assert.equal(state.deleteCount, 1, 'stale ownership document is deleted');
    assert.equal(state.createCount, 1);
    assert.equal(state.docs.length, 1);
    assert.equal(state.docs[0].channelId, C1);
    assert.match(textOf(message), /Channel claimed/i);
});

test('claim handles unique-index races (11000) by key pattern', async () => {
    const env = fresh();

    state.createError = { code: 11000, keyPattern: { userId: 1 } };
    const userRace = env.message(U1);
    await claim.run(env.client, userRace, []);
    assert.match(textOf(userRace), /already own a channel/);

    state.createError = { code: 11000, keyPattern: { channelId: 1 } };
    const channelRace = env.message(U2);
    await claim.run(env.client, channelRace, []);
    assert.match(textOf(channelRace), /just claimed by someone else/);

    state.createError = { code: '11000', keyPattern: {} };
    const genericRace = env.message(U3);
    await claim.run(env.client, genericRace, []);
    assert.match(textOf(genericRace), /conflicts with an existing channel registration/);
    assert.equal(state.docs.length, 0);
});

test('claim reports missing bot permissions before querying the registry', async () => {
    const env = fresh();
    env.botPermissions.delete(MANAGE_ROLES);
    const message = env.message(U1);

    await claim.run(env.client, message, []);

    assert.match(textOf(message), /Manage Roles/);
    assert.equal(state.queryCount, 0);
    assert.equal(state.createCount, 0);

    env.botPermissions.clear();
    const nothing = env.message(U1);
    await claim.run(env.client, nothing, []);
    const text = textOf(nothing);
    assert.match(text, /View Channel/);
    assert.match(text, /Send Messages/);
    assert.match(text, /Manage Roles/);
    assert.equal(state.queryCount, 0);
    assert.equal(state.createCount, 0);
});

test('claim contains an unexpected create failure instead of rejecting', async (t) => {
    muteExpectedErrors(t);
    const env = fresh();
    state.createError = new Error('boom');
    const message = env.message(U1);

    await assert.doesNotReject(() => claim.run(env.client, message, []));

    assert.match(textOf(message), /unexpected error/);
    assert.equal(state.docs.length, 0);
});

// ---------------------------------------------------------------------------
// Command authorisation
// ---------------------------------------------------------------------------

test('lock/whitelist/blacklist reject outsiders; admin and bot-owner bypass works', async () => {
    const env = fresh();
    const doc = env.addDoc();
    env.addMember(U2, 'bestie');

    const calls = [
        [lock, []],
        [whitelist, ['add', U2]],
        [blacklist, ['add', U2]],
    ];
    for (const [command, args] of calls) {
        const intruder = env.message(U3);
        await command.run(env.client, intruder, args);
        assert.match(textOf(intruder), /Only the channel owner/);
    }
    assert.equal(env.channel.setCallCount, 0, 'unauthorised commands never touch Discord');
    assert.equal(state.saveCount, 0, 'unauthorised commands never save');

    const admin = env.message(ADMIN_USER, { admin: true });
    await lock.run(env.client, admin, []);
    assert.match(textOf(admin), /Locked/);
    assert.equal(doc.locked, true);

    const adminWhitelist = env.message(ADMIN_USER, { admin: true });
    await whitelist.run(env.client, adminWhitelist, ['add', U2]);
    assert.match(textOf(adminWhitelist), /Added/);
    assert.deepEqual(doc.whitelist, [U2]);

    const adminBlacklist = env.message(ADMIN_USER, { admin: true });
    await blacklist.run(env.client, adminBlacklist, ['add', U2]);
    assert.match(textOf(adminBlacklist), /Added/);
    assert.deepEqual(doc.blacklist, [U2]);
    assert.deepEqual(doc.whitelist, []);

    const owner = env.message(U1);
    await unlock.run(env.client, owner, []);
    assert.match(textOf(owner), /Unlocked/);
    assert.equal(doc.locked, false);

    const botOwner = env.message(OWNER_USER);
    await lock.run(env.client, botOwner, []);
    assert.match(textOf(botOwner), /Locked/);
    assert.equal(doc.locked, true);
});

// ---------------------------------------------------------------------------
// Whitelist / blacklist command behaviour
// ---------------------------------------------------------------------------

test('whitelist resolves mentions and keeps working after a member leaves (remove by id)', async () => {
    const env = fresh();
    const doc = env.addDoc();
    env.addMember(U2, 'bestie');
    await lock.run(env.client, env.message(U1), []);

    const add = env.message(U1);
    await whitelist.run(env.client, add, ['add', `<@${U2}>`]);
    assert.match(textOf(add), /Added/);
    assert.deepEqual(doc.whitelist, [U2]);
    assert.equal(viewAt(env.channel, U2, MEMBER), 1);

    env.membersById.delete(U2);
    env.guild.members.cache.delete(U2);
    const remove = env.message(U1);
    await whitelist.run(env.client, remove, ['remove', U2]);
    assert.match(textOf(remove), /Removed/);
    assert.deepEqual(doc.whitelist, []);
    assert.equal(viewAt(env.channel, U2, MEMBER), 0, 'departed user was removable by id');
    assert.equal(overwriteAt(env.channel, U2, MEMBER), null, 'no leftover overlay for the removed user');
});

test('blacklist wins over whitelist, auto-removes it, and removal works after departure', async () => {
    const env = fresh();
    const doc = env.addDoc();
    env.addMember(U2, 'bestie');
    await lock.run(env.client, env.message(U1), []);

    const wlAdd = env.message(U1);
    await whitelist.run(env.client, wlAdd, ['add', U2]);
    assert.deepEqual(doc.whitelist, [U2]);

    const blAdd = env.message(U1);
    await blacklist.run(env.client, blAdd, ['add', U2]);
    assert.match(textOf(blAdd), /Added/);
    assert.deepEqual(doc.blacklist, [U2]);
    assert.deepEqual(doc.whitelist, [], 'blacklist add removes a conflicting whitelist entry');
    assert.equal(viewAt(env.channel, U2, MEMBER), -1, 'blacklisted user is denied while locked');

    const wlAgain = env.message(U1);
    await whitelist.run(env.client, wlAgain, ['add', U2]);
    assert.match(textOf(wlAgain), /blacklisted/);
    assert.deepEqual(doc.whitelist, [], 'whitelist add is refused while blacklisted');

    env.membersById.delete(U2);
    env.guild.members.cache.delete(U2);
    const blRemove = env.message(U1);
    await blacklist.run(env.client, blRemove, ['remove', U2]);
    assert.match(textOf(blRemove), /Removed/);
    assert.deepEqual(doc.blacklist, []);
    assert.equal(viewAt(env.channel, U2, MEMBER), 0, 'departed user was removable from the blacklist by id');
    assert.equal(overwriteAt(env.channel, U2, MEMBER), null, 'blacklist deny overlay is cleaned up');
});

test('whitelist add uses username, never displayName, at command level', async () => {
    const env = fresh();
    const doc = env.addDoc();
    env.addMember(U2, 'bestie', { displayName: 'trickster' });

    const displayName = env.message(U1);
    await whitelist.run(env.client, displayName, ['add', 'trickster']);
    assert.match(textOf(displayName), /couldn't find that user/);
    assert.deepEqual(doc.whitelist, []);
    assert.equal(env.channel.setCallCount, 0);

    const username = env.message(U1);
    await whitelist.run(env.client, username, ['add', 'BESTIE']);
    assert.match(textOf(username), /Added/);
    assert.deepEqual(doc.whitelist, [U2]);
});

test('blacklist accepts an explicit id and removes a departed user by mention', async () => {
    const env = fresh();
    const doc = env.addDoc();
    env.addMember(U2, 'bestie');

    const add = env.message(U1);
    await blacklist.run(env.client, add, ['add', U2]);
    assert.deepEqual(doc.blacklist, [U2]);
    assert.equal(viewAt(env.channel, U2, MEMBER), -1);

    env.membersById.delete(U2);
    env.guild.members.cache.delete(U2);
    const remove = env.message(U1);
    await blacklist.run(env.client, remove, ['remove', `<@${U2}>`]);
    assert.match(textOf(remove), /Removed/);
    assert.deepEqual(doc.blacklist, []);
    assert.equal(viewAt(env.channel, U2, MEMBER), 0, 'departed user was removable by mention');
});

// ---------------------------------------------------------------------------
// Model defaults/unique behaviour used by the commands
// ---------------------------------------------------------------------------

test('model double enforces the unique userId/channelId contract used by claim', async () => {
    fresh();
    const first = await model.create({ userId: U1, guildId: G1, channelId: C1 });
    assert.equal(first.locked, false);
    assert.deepEqual(first.whitelist, []);
    assert.deepEqual(first.blacklist, []);

    await assert.rejects(
        model.create({ userId: U1, guildId: G1, channelId: OTHER_CHANNEL }),
        (error) => Number(error.code) === 11000 && error.keyPattern.userId === 1,
    );
    await assert.rejects(
        model.create({ userId: U2, guildId: G1, channelId: C1 }),
        (error) => Number(error.code) === 11000 && error.keyPattern.channelId === 1,
    );
});
