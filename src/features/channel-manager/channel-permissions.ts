import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import { withChannelLock } from './channel-lock';
import type { ApplyResult, ChannelState, OverwritePlan, OwnershipDocument, PermissionChannel, PlannedOverwrite, ViewSnapshot, ViewState } from './types';

export { withChannelLock, drainChannelLocks } from './channel-lock';
export const VIEW = PermissionFlagsBits.ViewChannel;
export const ROLE = OverwriteType.Role;
export const MEMBER = OverwriteType.Member;

type TrackedOverwrite = PlannedOverwrite & { existed: boolean };

export function viewOf(allow: bigint, deny: bigint): ViewState {
    if ((deny & VIEW) !== 0n) return -1;
    if ((allow & VIEW) !== 0n) return 1;
    return 0;
}

function applyView(allow: bigint, deny: bigint, view: ViewState): [bigint, bigint] {
    const nextAllow = allow & ~VIEW;
    const nextDeny = deny & ~VIEW;
    if (view === 1) return [nextAllow | VIEW, nextDeny];
    if (view === -1) return [nextAllow, nextDeny | VIEW];
    return [nextAllow, nextDeny];
}

function uniqueIds(list: readonly string[]): string[] {
    return [...new Set(list.map((id) => id.trim()).filter((id) => id !== ''))];
}

function snapshotKey(id: string, type: OverwriteType): string {
    return `${type}:${id}`;
}

function normaliseSnapshots(raw: unknown): Map<string, ViewSnapshot> {
    const snapshots = new Map<string, ViewSnapshot>();
    if (!Array.isArray(raw)) return snapshots;
    const entries: readonly unknown[] = raw;
    for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) continue;
        if (!('id' in entry) || !('type' in entry) || !('view' in entry)) continue;
        if (typeof entry.id !== 'string' && typeof entry.id !== 'number' && typeof entry.id !== 'bigint') continue;
        const id = String(entry.id);
        const rawType = Number(entry.type);
        const view = Number(entry.view);
        if (!id || (rawType !== 0 && rawType !== 1) || (view !== -1 && view !== 0 && view !== 1)) continue;
        const type = rawType === 0 ? OverwriteType.Role : OverwriteType.Member;
        const key = snapshotKey(id, type);
        if (!snapshots.has(key)) snapshots.set(key, { id, type, view });
    }
    return snapshots;
}


function readOverwrites(channel: PermissionChannel): TrackedOverwrite[] {
    return [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: typeof overwrite.allow === 'bigint' ? overwrite.allow : overwrite.allow.bitfield,
        deny: typeof overwrite.deny === 'bigint' ? overwrite.deny : overwrite.deny.bitfield,
        existed: true,
    }));
}

export function planOverwrites(
    channel: PermissionChannel,
    doc: { userId: string; viewSnapshots?: readonly ViewSnapshot[] },
    nextState: ChannelState,
    botId: string,
): OverwritePlan {
    const ownerId = doc.userId;
    const everyoneId = channel.guild.roles?.everyone?.id || channel.guild.id;
    if (!everyoneId) throw new Error('Channel guild id is unavailable');
    const bot = botId || null;
    const locked = nextState.locked;
    const blacklist = uniqueIds(nextState.blacklist).filter((id) => id !== ownerId && id !== bot);
    const blacklistSet = new Set(blacklist);
    const whitelist = uniqueIds(nextState.whitelist)
        .filter((id) => id !== ownerId && id !== bot && !blacklistSet.has(id));
    const whitelistSet = new Set(whitelist);
    const current = readOverwrites(channel);
    const currentByKey = new Map(current.map((overwrite) => [snapshotKey(overwrite.id, overwrite.type), overwrite]));
    const snapshots = normaliseSnapshots(doc.viewSnapshots);
    const desired = new Map<string, ViewSnapshot>();
    const want = (id: string, type: OverwriteType, view: ViewState): void => {
        desired.set(snapshotKey(id, type), { id, type, view });
    };

    if (locked) {
        want(everyoneId, ROLE, -1);
        want(ownerId, MEMBER, 1);
        if (bot) want(bot, MEMBER, 1);
        for (const id of whitelist) want(id, MEMBER, 1);
        for (const id of blacklist) want(id, MEMBER, -1);

        // Role/member allows must not bypass the lock; unrelated bits stay live.
        for (const overwrite of current) {
            if ((overwrite.allow & VIEW) === 0n) continue;
            if (overwrite.id === ownerId || overwrite.id === bot || whitelistSet.has(overwrite.id)) continue;
            if (overwrite.id === everyoneId || blacklistSet.has(overwrite.id)) continue;
            want(overwrite.id, overwrite.type, (overwrite.deny & VIEW) !== 0n ? -1 : 0);
        }
        // Removed list entries retain their first baseline until unlock.
        for (const [key, snapshot] of snapshots) {
            if (desired.has(key)) continue;
            if (blacklistSet.has(snapshot.id)) {
                want(snapshot.id, snapshot.type, -1);
                continue;
            }
            want(snapshot.id, snapshot.type, snapshot.view === 1 ? 0 : snapshot.view);
        }
    } else {
        for (const id of blacklist) want(id, MEMBER, -1);
        for (const [key, snapshot] of snapshots) {
            if (blacklistSet.has(snapshot.id) || desired.has(key)) continue;
            want(snapshot.id, snapshot.type, snapshot.view);
        }
    }

    const result = new Map<string, TrackedOverwrite>();
    for (const [key, overwrite] of currentByKey) result.set(key, { ...overwrite });
    for (const [key, target] of desired) {
        const existing = result.get(key);
        const allow = existing?.allow ?? 0n;
        const deny = existing?.deny ?? 0n;
        const beforeView = viewOf(allow, deny);
        const [nextAllow, nextDeny] = applyView(allow, deny, target.view);
        const changed = beforeView !== target.view || nextAllow !== allow || nextDeny !== deny;
        if (!existing && nextAllow === 0n && nextDeny === 0n) continue;
        result.set(key, {
            id: target.id, type: target.type, allow: nextAllow, deny: nextDeny,
            existed: existing?.existed ?? false,
        });
        if (changed && !snapshots.has(key)) {
            snapshots.set(key, { id: target.id, type: target.type, view: beforeView });
        }
    }

    // Empty feature overlays are residue; baseline allow/deny overwrites survive.
    for (const [key, overwrite] of result) {
        const snapshot = snapshots.get(key);
        if (overwrite.allow === 0n && overwrite.deny === 0n
            && (!overwrite.existed || snapshot?.view === 0)) {
            result.delete(key);
            if (!locked) snapshots.delete(key);
        }
    }
    if (!locked) {
        for (const [key, snapshot] of snapshots) {
            if (!blacklistSet.has(snapshot.id)) snapshots.delete(key);
        }
    }
    const compare = (a: { type: OverwriteType; id: string }, b: { type: OverwriteType; id: string }): number =>
        (a.type - b.type) || a.id.localeCompare(b.id);
    const overwrites = [...result.values()].sort(compare).map(({ id, type, allow, deny }) => ({ id, type, allow, deny }));
    const snapshotList = [...snapshots.values()].sort(compare).map(({ id, type, view }) => ({ id, type, view }));
    return { overwrites, snapshots: snapshotList, blacklist, whitelist };
}

function sameOverwrites(a: readonly PlannedOverwrite[], b: readonly PlannedOverwrite[]): boolean {
    if (a.length !== b.length) return false;
    const byKey = new Map(b.map((overwrite) => [snapshotKey(overwrite.id, overwrite.type), overwrite]));
    return a.every((overwrite) => {
        const other = byKey.get(snapshotKey(overwrite.id, overwrite.type));
        return other !== undefined && overwrite.allow === other.allow && overwrite.deny === other.deny;
    });
}

export async function applyChannelState(
    channel: PermissionChannel,
    doc: OwnershipDocument,
    nextState: ChannelState,
    botId: string,
    reason?: string,
): Promise<ApplyResult> {
    if (!channel?.permissionOverwrites || typeof channel.permissionOverwrites.set !== 'function') {
        return { ok: false, code: 'INVALID_CHANNEL', message: 'Channel does not support permission overwrites' };
    }
    if (!doc?.userId) return { ok: false, code: 'INVALID_DOC', message: 'Ownership document has no owner' };
    if (!nextState || typeof nextState !== 'object') {
        return { ok: false, code: 'INVALID_STATE', message: 'Missing desired channel state' };
    }
    if (typeof doc.save !== 'function') return { ok: false, code: 'INVALID_DOC', message: 'Ownership document cannot be saved' };

    return withChannelLock(channel.id, async (): Promise<ApplyResult> => {
        const previous = {
            locked: doc.locked,
            whitelist: [...doc.whitelist],
            blacklist: [...doc.blacklist],
            viewSnapshots: [...normaliseSnapshots(doc.viewSnapshots).values()],
        };
        let plan: OverwritePlan;
        try {
            plan = planOverwrites(channel, doc, nextState, botId);
        } catch (error: unknown) {
            return { ok: false, code: 'INVALID_CHANNEL', message: error instanceof Error ? error.message : String(error), error };
        }
        const before = readOverwrites(channel).map(({ id, type, allow, deny }) => ({ id, type, allow, deny }));
        const changed = !sameOverwrites(before, plan.overwrites);
        doc.locked = nextState.locked;
        doc.whitelist = plan.whitelist;
        doc.blacklist = plan.blacklist;
        doc.viewSnapshots = plan.snapshots;
        const restore = (): void => {
            doc.locked = previous.locked;
            doc.whitelist = previous.whitelist;
            doc.blacklist = previous.blacklist;
            doc.viewSnapshots = previous.viewSnapshots;
        };
        if (changed) {
            try {
                await channel.permissionOverwrites.set(plan.overwrites, reason || 'Channel Manager');
            } catch (error: unknown) {
                restore();
                return { ok: false, code: 'DISCORD_UPDATE_FAILED', message: 'Discord rejected the permission update', error };
            }
        }
        try {
            await doc.save();
        } catch (error: unknown) {
            restore();
            if (!changed) {
                return { ok: false, code: 'SAVE_FAILED', message: 'Discord permissions were unchanged, but saving the ownership state failed', rolledBack: true, error };
            }
            try {
                await channel.permissionOverwrites.set(before, 'Channel Manager rollback');
                return { ok: false, code: 'SAVE_FAILED', message: 'Discord was updated but the ownership state could not be saved; the previous permissions were restored', rolledBack: true, error };
            } catch (rollbackError: unknown) {
                return { ok: false, code: 'SAVE_FAILED_ROLLBACK_FAILED', message: 'Discord was updated but the state could not be saved, and restoring the previous permissions also failed', rolledBack: false, needsReconciliation: true, error, rollbackError };
            }
        }
        return {
            ok: true, changed,
            state: { locked: nextState.locked, whitelist: [...plan.whitelist], blacklist: [...plan.blacklist] },
            snapshots: plan.snapshots, overwrites: plan.overwrites,
        };
    });
}
