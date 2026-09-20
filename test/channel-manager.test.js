// Smoke test for the Channel Manager feature — run with: node test/channel-manager.test.js
// Mocks mongoose and Discord objects; no real network or DB calls.
const Module = require('module');
const orig = Module.prototype.require;
const store = [];
const mkQuery = (filter) => ({ exec: async () => store.filter(d => Object.entries(filter).every(([k, v]) => d[k] === v))[0] || null });
Module.prototype.require = function (p) {
    if (p === 'mongoose') return {
        model: () => ({
            findOne: (f) => mkQuery(f),
            create: async (d) => {
                const doc = { ...d, whitelist: [], blacklist: [], locked: false, async save() { return this; } };
                store.push(doc); return doc;
            },
        }),
        Schema: function () { },
    };
    return orig.apply(this, arguments);
};

const assert = (cond, label) => { if (!cond) { console.error('FAIL:', label); process.exitCode = 1; } else console.log('PASS:', label); };

(async () => {
    const overwrites = new Map();
    const everyone = { id: '@everyone' };
    const channel = {
        id: 'C1',
        guild: { id: 'G1', roles: { everyone } },
        permissionOverwrites: {
            edit: async (who, perms) => { overwrites.set(who.id ?? who, perms); },
            delete: async (who) => { overwrites.delete(who.id ?? who); },
        },
    };
    const mkMsg = (userId) => ({
        author: { id: userId, username: 'frisky' },
        member: { permissions: { has: () => false } },
        channel, guild: channel.guild,
        reply: async (x) => (typeof x === 'string' ? x : x.content) || '[embed reply]',
    });
    const client = {
        config: { ownerID: 'OWNER' },
        discord: { EmbedBuilder: class { addFields() { return this } setColor() { return this } setFooter() { return this } setTimestamp() { return this } setTitle() { return this } } },
    };

    const claim = require('../commands/Channel Manager/claim.js');
    const lock = require('../commands/Channel Manager/lock.js');
    const unlock = require('../commands/Channel Manager/unlock.js');
    const wl = require('../commands/Channel Manager/whitelist.js');
    const bl = require('../commands/Channel Manager/blacklist.js');

    const msg = mkMsg('U1');
    const memberCache = new Map([['U2', { id: 'U2', user: { username: 'bestie' } }]]);
    channel.guild.members = {
        fetch: async () => null,
        fetchMe: async () => ({ id: 'BOT', permissionsIn: () => ({ has: () => true }) }),
        cache: { find: (fn) => [...memberCache.values()].find(fn) },
    };

    // 1. claim
    await claim.run(client, msg, []);
    assert(store.length === 1 && store[0].userId === 'U1', 'claim registers owner U1 -> C1');
    // claim again -> should NOT create a second doc
    await claim.run(client, msg, []);
    assert(store.length === 1, 'one channel per user enforced');

    // someone else claims the same channel
    const other = mkMsg('U3');
    await claim.run(client, other, []);
    assert(store.length === 1, 'one channel per channel enforced');

    // 2. lock
    await lock.run(client, msg, []);
    assert(overwrites.get('@everyone')?.ViewChannel === false, 'lock denies @everyone ViewChannel');
    assert(overwrites.get('U1')?.ViewChannel === true, 'lock keeps owner visible');
    assert(store[0].locked === true, 'locked flag persisted');

    // 3. whitelist add by username
    await wl.run(client, msg, ['add', 'Bestie']); // case-insensitive username
    assert(store[0].whitelist.includes('U2'), 'whitelist add by username works');
    assert(overwrites.get('U2')?.ViewChannel === true, 'whitelisted user can see locked channel');

    // 4. blacklist add same user -> auto-removes from whitelist
    await bl.run(client, msg, ['add', 'bestie']);
    assert(store[0].blacklist.includes('U2') && !store[0].whitelist.includes('U2'), 'blacklist add auto-removes whitelist entry');
    assert(overwrites.get('U2')?.ViewChannel === false, 'blacklisted user denied even while locked');

    // 5. whitelist add while blacklisted -> refused
    await wl.run(client, msg, ['add', 'bestie']);
    assert(!store[0].whitelist.includes('U2'), 'whitelist add refused while blacklisted');

    // 6. unlock
    await unlock.run(client, msg, []);
    assert(!overwrites.has('@everyone') && !overwrites.has('U1'), 'unlock removes owner/@everyone overwrites');
    assert(store[0].locked === false, 'unlocked flag persisted');
    assert(overwrites.get('U2')?.ViewChannel === false, 'blacklisted user stays denied after unlock');

    // 7. intruder tries lock
    const intruder = mkMsg('U9');
    const r = await lock.run(client, intruder, []);
    assert(store[0].locked === false, 'intruder cannot lock (not owner/admin)');

    // 8. blacklist remove
    await bl.run(client, msg, ['remove', 'bestie']);
    assert(!store[0].blacklist.includes('U2'), 'blacklist remove works');
    assert(!overwrites.has('U2'), 'blacklist remove clears the deny overwrite');

    // 9. admin bypass
    const admin = mkMsg('ADMIN');
    admin.member.permissions.has = () => true;
    await lock.run(client, admin, []);
    assert(store[0].locked === true, 'admin can lock without being owner');

    // 10. resolver errors: notfound
    const r2 = await wl.run(client, msg, ['add', 'nobody']);
    assert(!store[0].whitelist.length, 'notfound user is not whitelisted');

    console.log('\nStore at end:', JSON.stringify(store));
    console.log('Overwrites at end:', JSON.stringify([...overwrites]));
})();
