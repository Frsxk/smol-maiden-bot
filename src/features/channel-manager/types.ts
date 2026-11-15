import type { OverwriteType } from 'discord.js';

export type ViewState = -1 | 0 | 1;

export interface ViewSnapshot {
    id: string;
    type: OverwriteType;
    view: ViewState;
}

export interface ChannelState {
    locked: boolean;
    whitelist: string[];
    blacklist: string[];
}

export interface OwnershipRecord extends ChannelState {
    userId: string;
    guildId: string;
    channelId: string;
    viewSnapshots: ViewSnapshot[];
}

export interface OwnershipDocument extends OwnershipRecord {
    save(): Promise<unknown>;
}

export interface PlannedOverwrite {
    id: string;
    type: OverwriteType;
    allow: bigint;
    deny: bigint;
}

export interface LiveOverwrite {
    id: string;
    type: OverwriteType;
    allow: bigint | { readonly bitfield: bigint };
    deny: bigint | { readonly bitfield: bigint };
}

export interface PermissionChannel {
    id: string;
    guild: { id: string; roles?: { everyone?: { id: string } } };
    permissionOverwrites: {
        cache: { values(): IterableIterator<LiveOverwrite> };
        set(overwrites: readonly PlannedOverwrite[], reason?: string): Promise<unknown>;
    };
}

export interface OverwritePlan {
    overwrites: PlannedOverwrite[];
    snapshots: ViewSnapshot[];
    whitelist: string[];
    blacklist: string[];
}

export type ApplyResult =
    | { ok: true; changed: boolean; state: ChannelState; snapshots: ViewSnapshot[]; overwrites: PlannedOverwrite[] }
    | { ok: false; code: 'INVALID_CHANNEL' | 'INVALID_DOC' | 'INVALID_STATE'; message: string; error?: unknown }
    | { ok: false; code: 'DISCORD_UPDATE_FAILED'; message: string; error: unknown }
    | { ok: false; code: 'SAVE_FAILED'; message: string; rolledBack: true; error: unknown }
    | { ok: false; code: 'SAVE_FAILED_ROLLBACK_FAILED'; message: string; rolledBack: false; needsReconciliation: true; error: unknown; rollbackError: unknown };
