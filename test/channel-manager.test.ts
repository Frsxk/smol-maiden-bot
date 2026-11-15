import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Client, GatewayIntentBits, OverwriteType, PermissionFlagsBits } from 'discord.js';
import type { MessageReplyOptions } from 'discord.js';
import { applyChannelState, planOverwrites, viewOf, withChannelLock } from '../src/features/channel-manager/channel-permissions';
import { createManagement, resolveTarget } from '../src/features/channel-manager/management';
import type { ManagementInput, ManagementMember, ManagedCommand } from '../src/features/channel-manager/management';
import type { ChannelState, OwnershipDocument, PermissionChannel, PlannedOverwrite } from '../src/features/channel-manager/types';
import type { CreateOwnership, OwnershipStore } from '../src/database/ownership-store';
import { parseMessageId, prefixCommands, slashCommands, updatePin } from '../src/commands/channel-manager';

const U1 = '111111111111111111', U2 = '222222222222222222', U3 = '333333333333333333', U4 = '444444444444444444';
const ADMIN_USER = '555555555555555555', OWNER = '666666666666666666', BOT = '777777777777777777';
const G1 = '888888888888888888', C1 = '999999999999999999', G2 = '121212121212121212', C2 = '131313131313131313', R1 = '101010101010101010';
const VIEW = PermissionFlagsBits.ViewChannel, SEND = PermissionFlagsBits.SendMessages, REACTIONS = PermissionFlagsBits.AddReactions;
const ROLE = OverwriteType.Role, MEMBER = OverwriteType.Member;
const locked: ChannelState = { locked: true, whitelist: [], blacklist: [] };

function fixture() {
    const state = {
        ready: true, docs: [] as OwnershipDocument[], queries: 0, creates: 0, saves: 0, deletes: 0,
        createError: null as Error | null, saveError: null as Error | null,
    };
    const cache = new Map<string, PlannedOverwrite>();
    const writes: { list: PlannedOverwrite[]; reason: string | undefined }[] = [];
    const failWrites = new Set<number>();
    const channel: PermissionChannel & { type: ChannelType; isThread(): boolean } = {
        id: C1, type: ChannelType.GuildText, isThread: () => false,
        guild: { id: G1, roles: { everyone: { id: G1 } } },
        permissionOverwrites: {
            cache,
            async set(list, reason) {
                writes.push({ list: list.map(entry => ({ ...entry })), reason });
                if (failWrites.has(writes.length)) throw new Error('Missing Permissions');
                cache.clear();
                for (const entry of list) cache.set(`${entry.id}:${entry.type}`, { ...entry });
            },
        },
    };
    const makeDoc = (data: CreateOwnership): OwnershipDocument => ({
        userId: data.userId, guildId: data.guildId, channelId: data.channelId,
        locked: data.locked ?? false, whitelist: [...data.whitelist ?? []], blacklist: [...data.blacklist ?? []], viewSnapshots: [...data.viewSnapshots ?? []],
        async save() { state.saves++; if (state.saveError) throw state.saveError; },
    });
    const store: OwnershipStore = {
        isReady: () => state.ready,
        async findByUser(id) { state.queries++; return state.docs.find(doc => doc.userId === id) ?? null; },
        async findByChannel(id) { state.queries++; return state.docs.find(doc => doc.channelId === id) ?? null; },
        async create(data) {
            state.creates++;
            if (state.createError) throw state.createError;
            if (state.docs.some(doc => doc.userId === data.userId)) throw Object.assign(new Error('Duplicate user'), { code: 11000, keyPattern: { userId: 1 } });
            if (state.docs.some(doc => doc.channelId === data.channelId)) throw Object.assign(new Error('Duplicate channel'), { code: 11000, keyPattern: { channelId: 1 } });
            const doc = makeDoc(data); state.docs.push(doc); return doc;
        },
        async deleteByChannel(id) { state.deletes++; state.docs = state.docs.filter(doc => doc.channelId !== id); },
        async save(doc) { await doc.save(); },
    };
    const members = new Map<string, ManagementMember>();
    const botPermissions = new Set<bigint>([VIEW, SEND, PermissionFlagsBits.ManageRoles]);
    const input: ManagementInput = {
        author: { id: U1, username: 'tester' }, channel, guildId: G1, guildOwnerId: OWNER, botId: BOT,
        administrator: false, manageChannels: true, config: { ownerID: OWNER, embedColor: '#2f3136', embedFooterText1: 'Smol Maiden' },
        botPermissions: async () => ({ has: bit => botPermissions.has(bit) }),
        fetchChannel: async id => id === C1 ? channel : null,
        async fetchMember(id) { const member = members.get(id); if (!member) throw Object.assign(new Error('Unknown Member'), { code: 10007 }); return member; },
        cachedMembers: () => members.values(),
        searchMembers: async query => [...members.values()].filter(member => member.user.username.toLowerCase().startsWith(query.toLowerCase())),
        async reply(payload) { replies.push(payload); },
    };
    const replies: MessageReplyOptions[] = [];
    const run = createManagement({ store, apply: applyChannelState, lock: withChannelLock });
    return {
        state, cache, writes, failWrites, channel, store, members, botPermissions, input, replies,
        addDoc(data: Partial<CreateOwnership> = {}) { const doc = makeDoc({ userId: U1, guildId: G1, channelId: C1, ...data }); state.docs.push(doc); return doc; },
        addMember(id = U2, username = 'bestie', admin = false) {
            const member: ManagementMember = { id, user: { username }, permissions: { has: bit => admin && bit === PermissionFlagsBits.Administrator } };
            members.set(id, member); return member;
        },
        seed(id: string, type: OverwriteType, allow = 0n, deny = 0n) { cache.set(`${id}:${type}`, { id, type, allow, deny }); },
        view(id: string, type: OverwriteType) { const entry = cache.get(`${id}:${type}`); return entry ? viewOf(entry.allow, entry.deny) : 0; },
        text() {
            return replies.map(payload => [payload.content ?? '', ...(payload.embeds ?? []).map(embed => {
                const data = 'toJSON' in embed ? embed.toJSON() : embed;
                return [data.title, data.description, ...(data.fields ?? []).flatMap(field => [field.name, field.value])].join('\n');
            })].join('\n')).join('\n');
        },
        async run(command: ManagedCommand, args: readonly string[] = []) { await run(command, input, args); },
    };
}

test('viewOf uses deny-over-allow precedence and ignores unrelated bits', () => {
    assert.equal(viewOf(VIEW, 0n), 1); assert.equal(viewOf(0n, VIEW), -1); assert.equal(viewOf(VIEW, VIEW), -1); assert.equal(viewOf(SEND, SEND), 0);
});
test('lock masks role and member allows, preserves unrelated bits and canonical ordering', () => {
    const f = fixture(); f.seed(R1, ROLE, VIEW | SEND); f.seed(U2, MEMBER, VIEW | REACTIONS); f.seed(U4, MEMBER, VIEW);
    const plan = planOverwrites(f.channel, f.addDoc(), { ...locked, whitelist: [U3, U4, U3, U1, BOT], blacklist: [U4] }, BOT);
    const view = (id: string, type: OverwriteType) => { const entry = plan.overwrites.find(item => item.id === id && item.type === type); return entry ? viewOf(entry.allow, entry.deny) : 0; };
    assert.equal(view(G1, ROLE), -1); assert.equal(view(U1, MEMBER), 1); assert.equal(view(BOT, MEMBER), 1); assert.equal(view(U3, MEMBER), 1); assert.equal(view(U4, MEMBER), -1);
    assert.equal(view(R1, ROLE), 0); assert.equal(view(U2, MEMBER), 0);
    assert.equal(plan.overwrites.find(item => item.id === R1)?.allow, SEND); assert.equal(plan.overwrites.find(item => item.id === U2)?.allow, REACTIONS);
    assert.deepEqual(plan.whitelist, [U3]); assert.deepEqual(plan.blacklist, [U4]);
    assert.deepEqual(plan.overwrites, [...plan.overwrites].sort((a, b) => a.type - b.type || a.id.localeCompare(b.id)));
});
test('lock then unlock restores private baseline, role allows, unrelated denies and clears snapshots', async () => {
    const f = fixture(); f.seed(G1, ROLE, 0n, VIEW | SEND); f.seed(R1, ROLE, VIEW | SEND); f.seed(U2, MEMBER, VIEW, SEND); const doc = f.addDoc();
    assert.equal((await applyChannelState(f.channel, doc, locked, BOT)).ok, true);
    assert.equal(f.view(R1, ROLE), 0); assert.equal(f.view(U2, MEMBER), 0); assert.equal(f.view(U1, MEMBER), 1);
    assert.equal((await applyChannelState(f.channel, doc, { ...locked, locked: false }, BOT)).ok, true);
    assert.equal(f.view(G1, ROLE), -1); assert.equal(f.view(R1, ROLE), 1); assert.equal(f.view(U2, MEMBER), 1);
    assert.equal(f.cache.get(`${G1}:${ROLE}`)?.deny, VIEW | SEND); assert.equal(f.cache.get(`${U2}:${MEMBER}`)?.deny, SEND);
    assert.equal(f.cache.has(`${U1}:${MEMBER}`), false); assert.equal(f.cache.has(`${BOT}:${MEMBER}`), false); assert.deepEqual(doc.viewSnapshots, []);
});
test('unlock removes feature-created public overlays', async () => {
    const f = fixture(); const doc = f.addDoc(); await applyChannelState(f.channel, doc, locked, BOT); assert.equal(f.cache.size, 3);
    await applyChannelState(f.channel, doc, { ...locked, locked: false }, BOT); assert.equal(f.cache.size, 0); assert.deepEqual(doc.viewSnapshots, []);
});
test('save failure rolls exact permissions and document back', async () => {
    const f = fixture(); f.seed(U2, MEMBER, VIEW, SEND); const doc = f.addDoc({ whitelist: [U3], blacklist: [U4], viewSnapshots: [{ id: U3, type: MEMBER, view: 0 }] });
    const before = [...f.cache.values()]; const beforeDoc = { locked: doc.locked, whitelist: [...doc.whitelist], blacklist: [...doc.blacklist], viewSnapshots: [...doc.viewSnapshots] };
    f.state.saveError = new Error('database unavailable'); const result = await applyChannelState(f.channel, doc, { ...locked, whitelist: [U3], blacklist: [U4] }, BOT);
    assert.equal(result.ok, false); if (result.ok) assert.fail(); assert.equal(result.code, 'SAVE_FAILED');
    assert.equal(f.state.saves, 1); assert.equal(f.writes.length, 2); assert.match(f.writes[1]?.reason ?? '', /rollback/); assert.deepEqual([...f.cache.values()], before);
    assert.deepEqual({ locked: doc.locked, whitelist: doc.whitelist, blacklist: doc.blacklist, viewSnapshots: doc.viewSnapshots }, beforeDoc);
});
test('rollback failure exposes reconciliation and leaves updated Discord state', async () => {
    const f = fixture(); const doc = f.addDoc(); f.state.saveError = new Error('database unavailable'); f.failWrites.add(2);
    const result = await applyChannelState(f.channel, doc, locked, BOT); assert.equal(result.ok, false);
    if (result.ok || result.code !== 'SAVE_FAILED_ROLLBACK_FAILED') assert.fail();
    assert.equal(result.rolledBack, false); assert.equal(result.needsReconciliation, true); assert.ok(result.error instanceof Error); assert.ok(result.rollbackError instanceof Error);
    assert.equal(f.writes.length, 2); assert.equal(doc.locked, false); assert.notEqual(f.cache.size, 0);
});
test('command Discord rejection never saves or reports success', async () => {
    const f = fixture(); const doc = f.addDoc(); f.failWrites.add(1); await f.run('lock');
    assert.match(f.text(), /Discord rejected/); assert.doesNotMatch(f.text(), /Success|Locked/); assert.equal(f.state.saves, 0); assert.equal(doc.locked, false); assert.equal(f.cache.size, 0);
});
test('core Discord rejection restores document fields', async () => {
    const f = fixture(); const doc = f.addDoc({ whitelist: [U3] }); f.failWrites.add(1);
    const result = await applyChannelState(f.channel, doc, { ...locked, whitelist: [U3] }, BOT);
    assert.equal(result.ok, false); if (result.ok) assert.fail(); assert.equal(result.code, 'DISCORD_UPDATE_FAILED'); assert.equal(f.state.saves, 0); assert.equal(doc.locked, false); assert.deepEqual(doc.whitelist, [U3]); assert.deepEqual(doc.viewSnapshots, []);
});
test('unchanged live state save failure does not write a rollback', async () => {
    const f = fixture(); const doc = f.addDoc(); await applyChannelState(f.channel, doc, locked, BOT); f.state.saveError = new Error('database unavailable');
    const result = await applyChannelState(f.channel, doc, locked, BOT); assert.equal(result.ok, false); if (result.ok || result.code !== 'SAVE_FAILED') assert.fail();
    assert.equal(result.rolledBack, true); assert.equal(f.writes.length, 1); assert.equal(doc.locked, true);
});
test('channel queue serializes, supports re-entry and recovers after errors', async () => {
    const order: string[] = []; const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
    const first = withChannelLock(C1, async () => { order.push('start'); started.resolve(); await gate.promise; order.push('end'); });
    await started.promise; const second = withChannelLock(C1, async () => { order.push('second'); }); gate.resolve(); await Promise.all([first, second]);
    assert.deepEqual(order, ['start', 'end', 'second']); assert.equal(await withChannelLock(C1, () => withChannelLock(C1, async () => 42)), 42);
    await assert.rejects(withChannelLock(C1, async () => { throw new Error('exploded'); })); assert.equal(await withChannelLock(C1, async () => 'recovered'), 'recovered');
});
test('resolution supports IDs, both mentions, departed removals and member-required additions', async () => {
    const f = fixture(); const member = f.addMember();
    for (const arg of [U2, `<@${U2}>`, `<@!${U2}>`]) assert.deepEqual(await resolveTarget(f.input, arg, { requireMember: true }), { id: U2, member });
    f.members.clear(); assert.deepEqual(await resolveTarget(f.input, U2), { id: U2, member: null }); assert.equal((await resolveTarget(f.input, U2, { requireMember: true })).error, 'notmember');
});
test('username matching is exact case-insensitive and never display or partial', async () => {
    const f = fixture(); f.addMember(); assert.equal((await resolveTarget(f.input, 'BESTIE')).id, U2);
    assert.equal((await resolveTarget(f.input, 'trickster')).error, 'notfound'); assert.equal((await resolveTarget(f.input, 'best')).error, 'notfound');
});
test('malformed mentions never become fetch-by-ID inputs', async () => {
    const f = fixture(); let fetches = 0; f.input.fetchMember = async id => { fetches++; return { id, user: { username: id }, permissions: { has: () => false } }; };
    for (const arg of ['<@not-a-snowflake>', '<@123>']) { const result = await resolveTarget(f.input, arg); assert.equal(result.error, 'notfound'); assert.equal(result.id, undefined); }
    assert.equal(fetches, 0);
});
test('disconnected registry fails fast before queries and writes for all ownership commands', async () => {
    const f = fixture(); f.addDoc(); f.state.ready = false;
    for (const command of ['claim', 'lock', 'unlock', 'whitelist', 'blacklist'] as const) await f.run(command);
    assert.match(f.text(), /registry is unavailable/); assert.equal(f.state.queries, 0); assert.equal(f.state.creates, 0); assert.equal(f.state.saves, 0); assert.equal(f.writes.length, 0);
});
test('claim requires channel ManageChannels even for administrators', async () => {
    const f = fixture(); f.input.manageChannels = false; await f.run('claim'); f.input.administrator = true; await f.run('claim');
    assert.match(f.text(), /Manage Channels/); assert.equal(f.state.creates, 0); assert.equal(f.state.queries, 0);
});
test('claim creates a default ownership record', async () => {
    const f = fixture(); await f.run('claim'); const doc = f.state.docs[0]; assert.ok(doc);
    assert.equal(doc.userId, U1); assert.equal(doc.guildId, G1); assert.equal(doc.channelId, C1); assert.equal(doc.locked, false);
    assert.deepEqual(doc.whitelist, []); assert.deepEqual(doc.blacklist, []); assert.deepEqual(doc.viewSnapshots, []); assert.match(f.text(), /Channel claimed/);
});
test('claim rejects threads and non-text channels before querying', async () => {
    const f = fixture(); f.channel.isThread = () => true; await f.run('claim'); assert.match(f.text(), /Threads cannot be claimed/);
    f.channel.isThread = () => false; f.channel.type = ChannelType.GuildVoice; await f.run('claim'); assert.match(f.text(), /Only regular text channels/); assert.equal(f.state.queries, 0);
});
test('claim enforces global user ownership and channel uniqueness', async () => {
    const f = fixture(); f.addDoc({ guildId: G2, channelId: C2 }); await f.run('claim'); assert.match(f.text(), /another server/); assert.equal(f.state.creates, 0);
    const other = fixture(); other.addDoc({ userId: U3 }); await other.run('claim'); assert.match(other.text(), /already owned by/); assert.equal(other.state.creates, 0);
});
test('claim deletes only a confirmed stale same-guild registration', async () => {
    const f = fixture(); f.addDoc({ channelId: C2 }); f.input.fetchChannel = async id => { assert.equal(id, C2); throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); }; await f.run('claim');
    assert.equal(f.state.deletes, 1); assert.equal(f.state.docs[0]?.channelId, C1); assert.match(f.text(), /Channel claimed/);
    const uncertain = fixture(); uncertain.addDoc({ channelId: C2 }); uncertain.input.fetchChannel = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); }; await uncertain.run('claim');
    assert.match(uncertain.text(), /Nothing was changed/); assert.equal(uncertain.state.deletes, 0); assert.equal(uncertain.state.creates, 0);
    const failedDelete = fixture(); failedDelete.addDoc({ channelId: C2 });
    failedDelete.store.deleteByChannel = async id => { assert.equal(id, C2); failedDelete.state.deletes++; throw Object.assign(new Error('Registry delete failed'), { code: 10003 }); };
    await failedDelete.run('claim');
    assert.equal(failedDelete.state.deletes, 1); assert.equal(failedDelete.state.creates, 0); assert.equal(failedDelete.state.docs[0]?.channelId, C2); assert.match(failedDelete.text(), /unexpected error/);
});
test('claim reports user, channel and generic unique-index races', async () => {
    for (const [keyPattern, message] of [[{ userId: 1 }, /already own a channel/], [{ channelId: 1 }, /just claimed by someone else/], [{}, /conflicts with an existing channel registration/]] as const) {
        const f = fixture(); f.state.createError = Object.assign(new Error('Duplicate registration'), { code: '11000', keyPattern }); await f.run('claim'); assert.match(f.text(), message); assert.equal(f.state.docs.length, 0);
    }
});
test('claim checks all bot permissions before database queries', async () => {
    const f = fixture(); f.botPermissions.delete(PermissionFlagsBits.ManageRoles); await f.run('claim'); assert.match(f.text(), /Manage Roles/); assert.equal(f.state.queries, 0);
    f.botPermissions.clear(); await f.run('claim'); assert.match(f.text(), /View Channel/); assert.match(f.text(), /Send Messages/); assert.equal(f.state.queries, 0);
});
test('claim contains unexpected create failures', async () => {
    const f = fixture(); f.state.createError = new Error('boom'); await assert.doesNotReject(f.run('claim')); assert.match(f.text(), /unexpected error/); assert.equal(f.state.docs.length, 0);
});
test('management rejects outsiders but permits owner, admin and bot-owner', async () => {
    const f = fixture(); const doc = f.addDoc(); f.addMember(); f.input.author.id = U3;
    await f.run('lock'); await f.run('whitelist', ['add', U2]); await f.run('blacklist', ['add', U2]); assert.equal(f.writes.length, 0); assert.equal(f.state.saves, 0); assert.match(f.text(), /Only the channel owner/);
    f.input.administrator = true; await f.run('lock'); await f.run('whitelist', ['add', U2]); await f.run('blacklist', ['add', U2]); assert.deepEqual(doc.blacklist, [U2]); assert.deepEqual(doc.whitelist, []);
    f.input.administrator = false; f.input.author.id = U1; await f.run('unlock'); assert.equal(doc.locked, false); f.input.author.id = OWNER; await f.run('lock'); assert.equal(doc.locked, true);
});
test('whitelist mention addition and departed ID removal restores empty overlay', async () => {
    const f = fixture(); const doc = f.addDoc(); f.addMember(); await f.run('lock'); await f.run('whitelist', ['add', `<@${U2}>`]); assert.deepEqual(doc.whitelist, [U2]); assert.equal(f.view(U2, MEMBER), 1);
    f.members.clear(); await f.run('whitelist', ['remove', U2]); assert.deepEqual(doc.whitelist, []); assert.equal(f.view(U2, MEMBER), 0); assert.equal(f.cache.has(`${U2}:${MEMBER}`), false);
});
test('blacklist wins over whitelist and departed removal cleans deny overlay', async () => {
    const f = fixture(); const doc = f.addDoc(); f.addMember(); await f.run('lock'); await f.run('whitelist', ['add', U2]); await f.run('blacklist', ['add', U2]);
    assert.deepEqual(doc.whitelist, []); assert.deepEqual(doc.blacklist, [U2]); assert.equal(f.view(U2, MEMBER), -1);
    await f.run('whitelist', ['add', U2]); assert.match(f.text(), /blacklisted/); assert.deepEqual(doc.whitelist, []);
    f.members.clear(); await f.run('blacklist', ['remove', U2]); assert.deepEqual(doc.blacklist, []); assert.equal(f.cache.has(`${U2}:${MEMBER}`), false);
});
test('whitelist command resolves exact username rather than display name', async () => {
    const f = fixture(); const doc = f.addDoc(); f.addMember(); await f.run('whitelist', ['add', 'trickster']); assert.match(f.text(), /couldn't find that user/); assert.deepEqual(doc.whitelist, []); assert.equal(f.writes.length, 0);
    await f.run('whitelist', ['add', 'BESTIE']); assert.deepEqual(doc.whitelist, [U2]);
});
test('blacklist accepts explicit IDs and departed mentions', async () => {
    const f = fixture(); const doc = f.addDoc(); f.addMember(); await f.run('blacklist', ['add', U2]); assert.equal(f.view(U2, MEMBER), -1);
    f.members.clear(); await f.run('blacklist', ['remove', `<@${U2}>`]); assert.deepEqual(doc.blacklist, []); assert.equal(f.view(U2, MEMBER), 0);
});
test('isolated store enforces unique global user and channel contracts', async () => {
    const f = fixture(); const doc = await f.store.create({ userId: U1, guildId: G1, channelId: C1 }); assert.equal(doc.locked, false); assert.deepEqual(doc.whitelist, []); assert.deepEqual(doc.blacklist, []);
    await assert.rejects(f.store.create({ userId: U1, guildId: G2, channelId: C2 }), { code: 11000, keyPattern: { userId: 1 } });
    await assert.rejects(f.store.create({ userId: U2, guildId: G1, channelId: C1 }), { code: 11000, keyPattern: { channelId: 1 } });
});
test('real Discord effective permissions hide role-allowed members and restore unrelated denies', async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    let overwrites = [{ id: R1, type: ROLE, allow: String(VIEW), deny: String(SEND) }];
    client.rest.get = async route => {
        if (route === `/guilds/${G1}`) return { id: G1, name: 'Fixture', owner_id: OWNER, roles: [{ id: G1, name: '@everyone', permissions: String(VIEW | SEND), position: 0 }, { id: R1, name: 'Reader', permissions: '0', position: 1 }] };
        if (route === `/guilds/${G1}/members/${U2}`) return { user: { id: U2, username: 'guest', discriminator: '0', avatar: null }, roles: [R1] };
        if (route === `/channels/${C1}`) return { id: C1, guild_id: G1, name: 'fixture', type: ChannelType.GuildText, permission_overwrites: overwrites };
        throw new Error(`Unexpected REST route: ${route}`);
    };
    try {
        const guild = await client.guilds.fetch(G1); const member = await guild.members.fetch(U2); const channel = await guild.channels.fetch(C1);
        assert.ok(channel?.type === ChannelType.GuildText);
        channel.permissionOverwrites.set = async entries => {
            overwrites = [...entries.values()].map(entry => {
                assert.ok('id' in entry && typeof entry.id === 'string' && typeof entry.type === 'number');
                assert.ok(typeof entry.allow === 'bigint'); assert.ok(typeof entry.deny === 'bigint');
                return { id: entry.id, type: entry.type, allow: entry.allow.toString(), deny: entry.deny.toString() };
            });
            const fresh = await guild.channels.fetch(C1, { force: true }); assert.ok(fresh?.type === ChannelType.GuildText);
            return channel;
        };
        const doc = fixture().addDoc(); assert.equal(channel.permissionsFor(member).has(VIEW), true);
        await applyChannelState(channel, doc, locked, BOT); assert.equal(channel.permissionsFor(member).has(VIEW), false);
        await applyChannelState(channel, doc, { ...locked, whitelist: [U2] }, BOT); assert.equal(channel.permissionsFor(member).has(VIEW), true);
        await applyChannelState(channel, doc, { ...locked, locked: false }, BOT); assert.equal(channel.permissionsFor(member).has(VIEW), true); assert.equal(channel.permissionsFor(member).has(SEND), false);
    } finally { await client.destroy(); }
});
test('blacklist protects channel owner, bot, guild owner and administrators', async () => {
    const f = fixture(); const doc = f.addDoc(); for (const id of [U1, BOT, OWNER, ADMIN_USER]) f.addMember(id, id, id === ADMIN_USER);
    for (const id of [U1, BOT, OWNER, ADMIN_USER]) await f.run('blacklist', ['add', id]);
    assert.match(f.text(), /can't blacklist/); assert.deepEqual(doc.blacklist, []); assert.equal(f.state.saves, 0); assert.equal(f.writes.length, 0);
});
test('command queue spans registry read, Discord refresh, modify, apply and save', async () => {
    const f = fixture(); const doc = f.addDoc(); f.addMember(U2); f.addMember(U3, 'other');
    const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>(); let fetches = 0;
    f.input.fetchChannel = async () => { fetches++; if (fetches === 1) { started.resolve(); await gate.promise; } return f.channel; };
    const first = f.run('whitelist', ['add', U2]); await started.promise; const second = f.run('whitelist', ['add', U3]);
    assert.equal(f.state.queries, 1); gate.resolve(); await Promise.all([first, second]); assert.deepEqual(doc.whitelist, [U2, U3]); assert.equal(f.state.saves, 2);
});
test('message IDs and Discord URLs are exact and same-channel', () => {
    assert.equal(parseMessageId(U2, G1, C1), U2); assert.equal(parseMessageId(`https://discord.com/channels/${G1}/${C1}/${U2}`, G1, C1), U2);
    for (const value of ['123', 'NaN', `https://discord.com/channels/${G1}/${C2}/${U2}`, `https://evil.test/channels/${G1}/${C1}/${U2}`, `https://discord.com/channels/${G2}/${C1}/${U2}`]) assert.equal(parseMessageId(value, G1, C1), null);
});
test('canonical command array preserves ten commands and aliases without slash additions', () => {
    assert.deepEqual(prefixCommands.map(command => [command.name, command.aliases]), [['claim', []], ['lock', ['l']], ['unlock', ['ul']], ['whitelist', ['wl', 'invite']], ['blacklist', ['bl', 'uninvite']], ['pin', ['p']], ['unpin', ['unp']], ['pinscount', ['pc']], ['create-channel', ['createch', 'newch']], ['upgrade', ['up', 'upg']]]);
    assert.deepEqual(slashCommands, []);
});

test('pin and unpin await Discord writes before reacting and propagate write failures', async () => {
    for (const action of ['pin', 'unpin'] as const) {
        const order: string[] = [];
        const gate = Promise.withResolvers<void>();
        const started = Promise.withResolvers<void>();
        const pending = updatePin(action, U2, {
            isPinned: async () => true,
            async write(actual, id) { assert.equal(actual, action); assert.equal(id, U2); order.push('write'); started.resolve(); await gate.promise; order.push('written'); },
            async react() { order.push('react'); },
        });
        await started.promise;
        assert.deepEqual(order, ['write']);
        gate.resolve();
        assert.equal(await pending, true);
        assert.deepEqual(order, ['write', 'written', 'react']);
        let reactions = 0;
        await assert.rejects(updatePin(action, U2, {
            isPinned: async () => true,
            async write() { throw new Error('Missing Permissions'); },
            async react() { reactions++; },
        }), /Missing Permissions/);
        assert.equal(reactions, 0);
    }
});

test('unpin refuses an unpinned message without writing or reacting', async () => {
    let writes = 0, reactions = 0;
    assert.equal(await updatePin('unpin', U2, {
        isPinned: async () => false,
        async write() { writes++; },
        async react() { reactions++; },
    }), false);
    assert.equal(writes, 0);
    assert.equal(reactions, 0);
});
