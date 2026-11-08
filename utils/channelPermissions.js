'use strict';

/**
 * Preserve each target's original ViewChannel value while managing access.
 * Discord and MongoDB do not share a transaction: failed saves trigger an
 * overwrite rollback; failed rollbacks require operator reconciliation.
 */

const { PermissionFlagsBits, OverwriteType } = require('discord.js');
const { AsyncLocalStorage } = require('node:async_hooks');

const VIEW = PermissionFlagsBits.ViewChannel;
const ROLE = OverwriteType.Role;
const MEMBER = OverwriteType.Member;

const channelLocks = new Map();
const lockContext = new AsyncLocalStorage();

/**
 * Serialize work per channel within this process. Re-entrant: a command can
 * hold the lock while applyChannelState() takes it again for the same channel.
 *
 * @template T
 * @param {string} channelId
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function withChannelLock(channelId, task) {
    const key = String(channelId);
    const held = lockContext.getStore();
    if (held && held.has(key)) return task();

    const previous = channelLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    channelLocks.set(key, tail);

    const run = previous.catch(() => {}).then(() => {
        const nextHeld = new Set(held || []);
        nextHeld.add(key);
        return lockContext.run(nextHeld, task);
    });

    return run.finally(() => {
        release();
        if (channelLocks.get(key) === tail) channelLocks.delete(key);
    });
}

function toBigInt(value) {
    if (value === null || value === undefined) return 0n;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
    if (typeof value === 'object') {
        if (typeof value.bitfield === 'bigint') return value.bitfield;
        if (typeof value.bitfield === 'number') return BigInt(Math.trunc(value.bitfield));
        if (typeof value.bitfield === 'string' && /^\d+$/.test(value.bitfield)) return BigInt(value.bitfield);
    }
    return 0n;
}

function viewOf(allow, deny) {
    if ((deny & VIEW) !== 0n) return -1;
    if ((allow & VIEW) !== 0n) return 1;
    return 0;
}

function applyView(allow, deny, view) {
    const nextAllow = allow & ~VIEW;
    const nextDeny = deny & ~VIEW;
    if (view === 1) return [nextAllow | VIEW, nextDeny];
    if (view === -1) return [nextAllow, nextDeny | VIEW];
    return [nextAllow, nextDeny];
}

function uniqueIds(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        if (raw === null || raw === undefined) continue;
        const id = String(raw).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

function snapshotKey(id, type) {
    return `${Number(type)}:${String(id)}`;
}

function normaliseSnapshots(raw) {
    const map = new Map();
    for (const entry of Array.isArray(raw) ? raw : []) {
        if (!entry) continue;
        const id = entry.id === undefined || entry.id === null ? '' : String(entry.id);
        const type = Number(entry.type);
        const view = Number(entry.view);
        if (!id || (type !== ROLE && type !== MEMBER) || ![-1, 0, 1].includes(view)) continue;
        const key = snapshotKey(id, type);
        if (!map.has(key)) map.set(key, { id, type, view });
    }
    return map;
}

function everyoneIdOf(channel) {
    const fromRole = channel?.guild?.roles?.everyone?.id;
    if (fromRole !== undefined && fromRole !== null && String(fromRole) !== '') return String(fromRole);
    const fromGuild = channel?.guild?.id ?? channel?.guildId;
    return fromGuild === undefined || fromGuild === null ? '' : String(fromGuild);
}

function readOverwrites(channel, everyoneId) {
    const manager = channel?.permissionOverwrites;
    if (!manager) return [];
    const source = manager.cache !== undefined ? manager.cache : manager;
    let values = [];
    if (source && typeof source.values === 'function') values = [...source.values()];
    else if (Array.isArray(source)) values = source;

    const out = [];
    for (const overwrite of values) {
        if (!overwrite) continue;
        const id = String(overwrite.id);
        const rawType = Number(overwrite.type);
        const type = rawType === ROLE || rawType === MEMBER
            ? rawType
            : (id === everyoneId ? ROLE : MEMBER);
        out.push({
            id,
            type,
            allow: toBigInt(overwrite.allow),
            deny: toBigInt(overwrite.deny),
            existed: true,
        });
    }
    return out;
}

/**
 * Build the complete overwrite list and the snapshot set for a desired state.
 * Pure: no Discord or database calls.
 *
 * @param {object} channel discord.js channel-like object
 * @param {object} doc ownership document
 * @param {{locked:boolean, whitelist:string[], blacklist:string[]}} nextState
 * @param {string} botId
 */
function planOverwrites(channel, doc, nextState, botId) {
    const ownerId = String(doc.userId);
    const everyoneId = everyoneIdOf(channel);
    if (!everyoneId) throw new Error('Channel guild id is unavailable');

    const bot = botId === undefined || botId === null || String(botId) === '' ? null : String(botId);
    const locked = Boolean(nextState.locked);
    const blacklist = uniqueIds(nextState.blacklist).filter((id) => id !== ownerId && id !== bot);
    const blacklistSet = new Set(blacklist);
    const whitelist = uniqueIds(nextState.whitelist)
        .filter((id) => id !== ownerId && id !== bot && !blacklistSet.has(id));
    const whitelistSet = new Set(whitelist);

    const current = readOverwrites(channel, everyoneId);
    const currentByKey = new Map();
    for (const overwrite of current) {
        currentByKey.set(snapshotKey(overwrite.id, overwrite.type), overwrite);
    }

    const snapshots = normaliseSnapshots(doc.viewSnapshots);
    const desired = new Map(); // key -> { id, type, view }

    const want = (id, type, view) => {
        desired.set(snapshotKey(id, type), { id: String(id), type: Number(type), view });
    };

    if (locked) {
        // @everyone denied. The owner, the bot, and whitelisted members get
        // explicit allows; blacklisted members get an explicit deny.
        want(everyoneId, ROLE, -1);
        want(ownerId, MEMBER, 1);
        if (bot) want(bot, MEMBER, 1);
        for (const id of whitelist) want(id, MEMBER, 1);
        for (const id of blacklist) want(id, MEMBER, -1);

        // Any pre-existing explicit ViewChannel allow is neutralised unless it
        // belongs to the owner, bot, or a whitelisted member. Other permission
        // bits on the same overwrite are left untouched.
        for (const overwrite of current) {
            if ((overwrite.allow & VIEW) === 0n) continue;
            if (overwrite.id === ownerId || overwrite.id === bot || whitelistSet.has(overwrite.id)) continue;
            if (overwrite.id === everyoneId) continue;
            if (blacklistSet.has(overwrite.id)) continue;
            const keepDeny = (overwrite.deny & VIEW) !== 0n;
            want(overwrite.id, overwrite.type, keepDeny ? -1 : 0);
        }

        // A target previously touched by the feature but no longer listed is
        // kept neutral while locked. Its baseline stays in the snapshot for
        // the eventual unlock or whitelist/blacklist removal. A pre-existing
        // deny is restored immediately; a pre-existing allow stays
        // neutralised until unlock (lock rules forbid it).
        for (const [key, snapshot] of snapshots) {
            if (desired.has(key)) continue;
            if (blacklistSet.has(snapshot.id)) {
                want(snapshot.id, snapshot.type, -1);
                continue;
            }
            want(snapshot.id, snapshot.type, snapshot.view === 1 ? 0 : snapshot.view);
        }
    } else {
        // Blacklist is permanent until removed, locked or not.
        for (const id of blacklist) want(id, MEMBER, -1);

        // Unlock / removals restore the first-seen ViewChannel value. Other
        // permission bits are always copied from the current Discord state.
        for (const [key, snapshot] of snapshots) {
            if (blacklistSet.has(snapshot.id)) continue;
            if (desired.has(key)) continue;
            want(snapshot.id, snapshot.type, snapshot.view);
        }
    }

    const result = new Map();
    for (const [key, overwrite] of currentByKey) {
        result.set(key, { ...overwrite });
    }

    for (const [key, target] of desired) {
        const existing = result.get(key);
        const allow = existing ? existing.allow : 0n;
        const deny = existing ? existing.deny : 0n;
        const beforeView = viewOf(allow, deny);
        const [nextAllow, nextDeny] = applyView(allow, deny, target.view);
        const changed = beforeView !== target.view || nextAllow !== allow || nextDeny !== deny;

        if (!existing && nextAllow === 0n && nextDeny === 0n) continue;

        result.set(key, {
            id: target.id,
            type: target.type,
            allow: nextAllow,
            deny: nextDeny,
            existed: existing ? existing.existed : false,
        });

        if (changed && !snapshots.has(key)) {
            snapshots.set(key, { id: target.id, type: target.type, view: beforeView });
        }
    }

    // Never delete an unrelated pre-existing overwrite. A feature-created
    // overwrite that became completely empty is removed so unlock/removal
    // leaves no residue. Baseline view 0 means there was no ViewChannel bit
    // before the feature touched the target, so an empty overlay is residue.
    // A baseline allow/deny (-1/1) means the overwrite pre-dates the feature
    // and must be kept, even while its view bit is temporarily neutralised.
    for (const [key, overwrite] of result) {
        const snapshot = snapshots.get(key);
        if (overwrite.allow === 0n && overwrite.deny === 0n
            && (!overwrite.existed || (snapshot && snapshot.view === 0))) {
            result.delete(key);
            if (!locked) snapshots.delete(key);
        }
    }

    if (!locked) {
        for (const [key, snapshot] of [...snapshots]) {
            if (!blacklistSet.has(snapshot.id)) snapshots.delete(key);
        }
    }

    const overwrites = [...result.values()]
        .sort((a, b) => (a.type - b.type) || a.id.localeCompare(b.id))
        .map(({ id, type, allow, deny }) => ({ id, type, allow, deny }));

    const snapshotList = [...snapshots.values()]
        .sort((a, b) => (a.type - b.type) || a.id.localeCompare(b.id))
        .map(({ id, type, view }) => ({ id, type, view }));

    return { overwrites, snapshots: snapshotList, blacklist, whitelist };
}

function sameOverwrites(a, b) {
    if (a.length !== b.length) return false;
    const byKey = new Map(b.map((overwrite) => [snapshotKey(overwrite.id, overwrite.type), overwrite]));
    for (const overwrite of a) {
        const other = byKey.get(snapshotKey(overwrite.id, overwrite.type));
        if (!other) return false;
        if (overwrite.allow !== other.allow || overwrite.deny !== other.deny) return false;
    }
    return true;
}

function cloneSnapshots(value) {
    return normaliseSnapshots(value);
}

/**
 * Apply a desired ownership state to a channel and persist it.
 *
 * @param {object} channel discord.js channel (permissionOverwrites.cache + set)
 * @param {object} doc OwnedChannel document (save() required)
 * @param {{locked:boolean, whitelist:string[], blacklist:string[]}} nextState
 * @param {string} botId bot user id; gets an explicit ViewChannel allow while locked
 * @param {string} [reason] audit log reason
 * @returns {Promise<object>} { ok: true, changed, ... } or { ok: false, code, ... }
 */
async function applyChannelState(channel, doc, nextState, botId, reason) {
    if (!channel || !channel.permissionOverwrites || typeof channel.permissionOverwrites.set !== 'function') {
        return { ok: false, code: 'INVALID_CHANNEL', message: 'Channel does not support permission overwrites' };
    }
    if (!doc || doc.userId === undefined || doc.userId === null) {
        return { ok: false, code: 'INVALID_DOC', message: 'Ownership document has no owner' };
    }
    if (!nextState || typeof nextState !== 'object') {
        return { ok: false, code: 'INVALID_STATE', message: 'Missing desired channel state' };
    }
    if (typeof doc.save !== 'function') {
        return { ok: false, code: 'INVALID_DOC', message: 'Ownership document cannot be saved' };
    }

    return withChannelLock(channel.id, async () => {
        const previousDoc = {
            locked: doc.locked,
            whitelist: Array.isArray(doc.whitelist) ? [...doc.whitelist] : [],
            blacklist: Array.isArray(doc.blacklist) ? [...doc.blacklist] : [],
            viewSnapshots: [...cloneSnapshots(doc.viewSnapshots).values()].map((entry) => ({ ...entry })),
        };

        let plan;
        try {
            plan = planOverwrites(channel, doc, nextState, botId);
        } catch (error) {
            return { ok: false, code: 'INVALID_CHANNEL', message: error.message, error };
        }

        const before = readOverwrites(channel, everyoneIdOf(channel))
            .map(({ id, type, allow, deny }) => ({ id, type, allow, deny }));
        const changed = !sameOverwrites(before, plan.overwrites);

        doc.locked = Boolean(nextState.locked);
        doc.whitelist = plan.whitelist;
        doc.blacklist = plan.blacklist;
        doc.viewSnapshots = plan.snapshots;

        if (changed) {
            try {
                await channel.permissionOverwrites.set(plan.overwrites, reason || 'Channel Manager');
            } catch (error) {
                restoreDoc(doc, previousDoc);
                return {
                    ok: false,
                    code: 'DISCORD_UPDATE_FAILED',
                    message: 'Discord rejected the permission update',
                    error,
                };
            }
        }

        try {
            await doc.save();
        } catch (error) {
            restoreDoc(doc, previousDoc);
            if (!changed) {
                return {
                    ok: false,
                    code: 'SAVE_FAILED',
                    message: 'Discord permissions were unchanged, but saving the ownership state failed',
                    rolledBack: true,
                    error,
                };
            }
            try {
                await channel.permissionOverwrites.set(before, 'Channel Manager rollback');
                return {
                    ok: false,
                    code: 'SAVE_FAILED',
                    message: 'Discord was updated but the ownership state could not be saved; the previous permissions were restored',
                    rolledBack: true,
                    error,
                };
            } catch (rollbackError) {
                return {
                    ok: false,
                    code: 'SAVE_FAILED_ROLLBACK_FAILED',
                    message: 'Discord was updated but the state could not be saved, and restoring the previous permissions also failed',
                    rolledBack: false,
                    needsReconciliation: true,
                    error,
                    rollbackError,
                };
            }
        }

        return {
            ok: true,
            changed,
            state: {
                locked: Boolean(nextState.locked),
                whitelist: [...plan.whitelist],
                blacklist: [...plan.blacklist],
            },
            snapshots: plan.snapshots,
            overwrites: plan.overwrites,
        };
    });
}

function restoreDoc(doc, previous) {
    doc.locked = previous.locked;
    doc.whitelist = previous.whitelist;
    doc.blacklist = previous.blacklist;
    doc.viewSnapshots = previous.viewSnapshots;
}

module.exports = {
    applyChannelState,
    planOverwrites,
    withChannelLock,
    viewOf,
    VIEW,
    ROLE,
    MEMBER,
};
