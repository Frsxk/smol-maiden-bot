import { randomInt } from 'node:crypto';

export class GiveawayUserError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GiveawayUserError';
    }
}

export interface GiveawayLocation { guildId: string; channelId: string }
export interface GiveawayEntry { userId: string; guildId: string; messageId: string }
export interface GiveawayRequirement { type: 'none' | 'guild' | 'role'; id?: string }
export interface GiveawayRecord {
    message: string;
    prize: string;
    started: number;
    entry: GiveawayEntry[];
    entered: number;
    winCount: number;
    requirements: GiveawayRequirement;
    endTime: string | null;
    host: string;
    description: string;
    embeds: unknown;
    guildId?: string;
    channelId?: string;
    completed?: boolean;
    winners?: string[];
    pendingPublish?: boolean;
}
export interface LocatedGiveaway extends GiveawayRecord { guildId: string; channelId: string }
export interface GiveawayStore {
    list(): Promise<GiveawayRecord[]>;
    get(messageId: string): Promise<GiveawayRecord | null>;
    insert(record: GiveawayRecord): Promise<void>;
    save(record: GiveawayRecord): Promise<void>;
}
export interface GiveawayMember {
    userId: string;
    roleIds: readonly string[];
    administrator: boolean;
    manageGuild: boolean;
    manageEvents: boolean;
    bot: boolean;
}
export interface GiveawayTransport {
    create(location: GiveawayLocation, record: Omit<GiveawayRecord, 'message'>): Promise<string>;
    verify(location: GiveawayLocation, messageId: string): Promise<boolean>;
    member(guildId: string, userId: string): Promise<GiveawayMember | null>;
    publish(record: LocatedGiveaway): Promise<void>;
    discard(location: GiveawayLocation, messageId: string): Promise<void>;
}
export interface GiveawayActor extends GiveawayLocation { userId: string }
export interface CreateGiveaway extends GiveawayLocation {
    durationMs: number;
    winnerCount: number;
    prize: string;
    host: string;
    description?: string;
    requirements?: GiveawayRequirement;
}
export interface GiveawayDiagnostic { messageId: string; code: 'missing-location' | 'recovery-failed' | 'timer-failed' | 'cleanup-failed'; error: unknown }
export interface GiveawayScheduler {
    set(task: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
}
export interface GiveawayServiceOptions {
    store: GiveawayStore;
    transport: GiveawayTransport;
    legacyLocations?: Readonly<Record<string, GiveawayLocation>>;
    authorize?: (record: LocatedGiveaway, actor: GiveawayMember, action: 'end' | 'reroll') => boolean | Promise<boolean>;
    diagnostic?: (event: GiveawayDiagnostic) => void;
    now?: () => number;
    randomIndex?: (exclusiveMax: number) => number;
    scheduler?: GiveawayScheduler;
}
export interface GiveawayService {
    start(): Promise<GiveawayDiagnostic[]>;
    create(input: CreateGiveaway): Promise<LocatedGiveaway>;
    toggleEntry(messageId: string, actor: GiveawayActor): Promise<{ entered: boolean; record: LocatedGiveaway }>;
    end(messageId: string, actor: GiveawayActor): Promise<LocatedGiveaway>;
    reroll(messageId: string, actor: GiveawayActor): Promise<LocatedGiveaway>;
    stop(): Promise<void>;
}
export function defaultGiveawayAuthorization(_record: LocatedGiveaway, actor: GiveawayMember): boolean {
    return actor.administrator || actor.manageEvents;
}
export function isActiveGiveaway(record: GiveawayRecord): boolean {
    return record.completed !== true && record.endTime !== null && Number.isFinite(Number(record.endTime)) && Number(record.endTime) > 0;
}
export function selectGiveawayWinners(userIds: readonly string[], count: number, index: (max: number) => number = randomInt): string[] {
    const pool = [...new Set(userIds)];
    const result: string[] = [];
    while (pool.length > 0 && result.length < count) {
        const position = index(pool.length);
        if (!Number.isInteger(position) || position < 0 || position >= pool.length) throw new Error('Invalid random winner index.');
        const user = pool[position];
        if (user === undefined) throw new Error('Winner index was not found.');
        result.push(user);
        const last = pool.pop();
        if (position < pool.length && last !== undefined) pool[position] = last;
    }
    return result;
}
const defaultScheduler: GiveawayScheduler = {
    set(task, delayMs) { const timer = setTimeout(task, delayMs); timer.unref(); return timer; },
    clear(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

export function createGiveawayService(options: GiveawayServiceOptions): GiveawayService {
    const { store, transport } = options;
    const now = options.now ?? Date.now;
    const scheduler = options.scheduler ?? defaultScheduler;
    const queues = new Map<string, Promise<unknown>>();
    const timers = new Map<string, unknown>();
    const inFlight = new Set<Promise<unknown>>();
    let stopped = false;
    let startup: Promise<GiveawayDiagnostic[]> | undefined;
    function diagnostic(event: GiveawayDiagnostic): void {
        // Reporting must never turn a contained timer failure into an unhandled rejection.
        try { options.diagnostic?.(event); } catch {}
    }
    function track<T>(task: Promise<T>): Promise<T> {
        inFlight.add(task);
        void task.then(() => inFlight.delete(task), () => inFlight.delete(task));
        return task;
    }
    function serial<T>(id: string, task: () => Promise<T>): Promise<T> {
        if (stopped) return Promise.reject(new GiveawayUserError('Giveaway service is stopped.'));
        const pending = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(task);
        queues.set(id, pending);
        void pending.then(() => { if (queues.get(id) === pending) queues.delete(id); }, () => { if (queues.get(id) === pending) queues.delete(id); });
        return track(pending);
    }
    function cancel(id: string): void {
        if (timers.has(id)) { scheduler.clear(timers.get(id)); timers.delete(id); }
    }
    function schedule(record: LocatedGiveaway): void {
        cancel(record.message);
        if (stopped || !isActiveGiveaway(record)) return;
        const delay = Math.max(0, Math.min(2_147_483_647, Number(record.endTime) - now()));
        timers.set(record.message, scheduler.set(() => {
            timers.delete(record.message);
            void serial(record.message, async () => {
                const current = await located(record.message, record);
                if (!isActiveGiveaway(current)) return;
                if (Number(current.endTime) > now()) { schedule(current); return; }
                await finish(current);
            }).catch(error => diagnostic({ messageId: record.message, code: 'timer-failed', error }));
        }, delay));
    }
    async function located(id: string, hint?: GiveawayLocation): Promise<LocatedGiveaway> {
        const record = await store.get(id);
        if (!record) throw new GiveawayUserError('Giveaway not found.');
        const location = record.guildId && record.channelId
            ? { guildId: record.guildId, channelId: record.channelId }
            : hint ?? options.legacyLocations?.[id];
        if (!location) throw new GiveawayUserError(`Giveaway ${id} needs a legacy guildId/channelId mapping, or an interaction on its original message.`);
        if (hint && (hint.guildId !== location.guildId || hint.channelId !== location.channelId)) throw new GiveawayUserError('Giveaway location does not match this message.');
        if (!await transport.verify(location, id)) throw new GiveawayUserError('Original bot giveaway message could not be verified.');
        const result = { ...record, ...location };
        if (!record.guildId || !record.channelId) {
            await store.save(result);
            schedule(result);
        }
        return result;
    }
    async function eligible(record: LocatedGiveaway, userId: string): Promise<GiveawayMember | null> {
        const member = await transport.member(record.guildId, userId);
        if (!member || member.bot) return null;
        if (record.requirements.type === 'role' && (!record.requirements.id || !member.roleIds.includes(record.requirements.id))) return null;
        if (record.requirements.type === 'guild' && (!record.requirements.id || !await transport.member(record.requirements.id, userId))) return null;
        return member;
    }
    async function publish(record: LocatedGiveaway): Promise<LocatedGiveaway> {
        await transport.publish(record);
        const published = { ...record, pendingPublish: false };
        await store.save(published);
        return published;
    }
    async function finish(record: LocatedGiveaway): Promise<LocatedGiveaway> {
        const candidates: string[] = [];
        const seen = new Set<string>();
        for (const entry of record.entry) {
            if (entry.messageId !== record.message || entry.guildId !== record.guildId || seen.has(entry.userId)) continue;
            seen.add(entry.userId);
            if (await eligible(record, entry.userId)) candidates.push(entry.userId);
        }
        const result: LocatedGiveaway = {
            ...record, completed: true, pendingPublish: true,
            winners: selectGiveawayWinners(candidates, record.winCount, options.randomIndex),
        };
        await store.save(result);
        cancel(record.message);
        return publish(result);
    }
    async function authorize(record: LocatedGiveaway, actor: GiveawayActor, action: 'end' | 'reroll'): Promise<void> {
        const member = await transport.member(record.guildId, actor.userId);
        if (!member || !await (options.authorize ?? defaultGiveawayAuthorization)(record, member, action)) throw new GiveawayUserError('You are not authorized to manage this giveaway. By default, Administrator or Manage Events is required.');
    }
    async function recover(): Promise<GiveawayDiagnostic[]> {
        const issues: GiveawayDiagnostic[] = [];
        for (const record of await store.list()) {
            if (stopped) break;
            if (!isActiveGiveaway(record) && !record.pendingPublish) continue;
            if ((!record.guildId || !record.channelId) && !options.legacyLocations?.[record.message]) {
                const issue: GiveawayDiagnostic = { messageId: record.message, code: 'missing-location', error: new GiveawayUserError(`Set legacyLocations[${JSON.stringify(record.message)}] to { guildId, channelId }, or click the original giveaway to recover its location.`) };
                issues.push(issue); diagnostic(issue); continue;
            }
            try {
                await serial(record.message, async () => {
                    let current = await located(record.message);
                    if (current.pendingPublish) current = await publish(current);
                    if (isActiveGiveaway(current) && Number(current.endTime) <= now()) await finish(current);
                    else schedule(current);
                });
            } catch (error) {
                const issue: GiveawayDiagnostic = { messageId: record.message, code: 'recovery-failed', error };
                issues.push(issue); diagnostic(issue);
            }
        }
        return issues;
    }
    return {
        start(): Promise<GiveawayDiagnostic[]> {
            if (stopped) return Promise.reject(new GiveawayUserError('Giveaway service is stopped.'));
            startup ??= track(recover());
            return startup;
        },
        create(input: CreateGiveaway): Promise<LocatedGiveaway> {
            if (stopped) return Promise.reject(new GiveawayUserError('Giveaway service is stopped.'));
            return track((async () => {
                if (!input.guildId || !input.channelId || !input.host || !input.prize.trim() || input.prize.length > 256 || (input.description?.length ?? 0) > 3000) throw new GiveawayUserError('Giveaway requires a guild, channel, host, and prize (up to 256 characters); description may have up to 3000 characters.');
                if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0 || !Number.isSafeInteger(now() + input.durationMs)) throw new GiveawayUserError('Giveaway duration must be a positive integer number of milliseconds.');
                if (!Number.isInteger(input.winnerCount) || input.winnerCount < 1 || input.winnerCount > 100) throw new GiveawayUserError('Winner count must be between 1 and 100.');
                const requirement = input.requirements ?? { type: 'none' };
                if (requirement.type !== 'none' && !requirement.id) throw new GiveawayUserError('A role or guild requirement needs an ID.');
                const draft: Omit<GiveawayRecord, 'message'> = {
                    prize: input.prize.trim(), started: now(), entry: [], entered: 0, winCount: input.winnerCount,
                    requirements: requirement, endTime: String(now() + input.durationMs), host: input.host,
                    description: input.description ?? '', embeds: {}, guildId: input.guildId, channelId: input.channelId,
                    completed: false, winners: [], pendingPublish: true,
                };
                const message = await transport.create(input, draft);
                const record: LocatedGiveaway = { ...draft, message, guildId: input.guildId, channelId: input.channelId };
                try { await store.insert(record); }
                catch (error) {
                    try { await transport.discard(input, message); }
                    catch (cleanupError) { diagnostic({ messageId: message, code: 'cleanup-failed', error: cleanupError }); }
                    throw error;
                }
                return serial(message, async () => {
                    // Keep a recovery timer even when enabling the persisted message fails.
                    schedule(record);
                    return publish(record);
                });
            })());
        },
        toggleEntry(messageId: string, actor: GiveawayActor): Promise<{ entered: boolean; record: LocatedGiveaway }> {
            return serial(messageId, async () => {
                const record = await located(messageId, actor);
                if (!isActiveGiveaway(record) || Number(record.endTime) <= now()) throw new GiveawayUserError('This giveaway has ended.');
                const present = record.entry.some(entry => entry.userId === actor.userId);
                if (!present && !await eligible(record, actor.userId)) throw new GiveawayUserError('You do not meet this giveaway’s membership requirements.');
                const entries = record.entry.filter(entry => entry.userId !== actor.userId);
                if (!present) entries.push({ userId: actor.userId, guildId: record.guildId, messageId });
                const result = { ...record, entry: entries, entered: entries.length, pendingPublish: true };
                await store.save(result);
                schedule(result);
                return { entered: !present, record: await publish(result) };
            });
        },
        end(messageId: string, actor: GiveawayActor): Promise<LocatedGiveaway> {
            return serial(messageId, async () => {
                const record = await located(messageId, actor);
                await authorize(record, actor, 'end');
                if (!isActiveGiveaway(record)) {
                    if (record.pendingPublish) return publish(record);
                    throw new GiveawayUserError('This giveaway has already ended.');
                }
                return finish(record);
            });
        },
        reroll(messageId: string, actor: GiveawayActor): Promise<LocatedGiveaway> {
            return serial(messageId, async () => {
                const record = await located(messageId, actor);
                await authorize(record, actor, 'reroll');
                if (isActiveGiveaway(record)) throw new GiveawayUserError('End this giveaway before rerolling.');
                if (record.pendingPublish) throw new GiveawayUserError('The previous result has not been published. End again or restart to retry delivery first.');
                return finish(record);
            });
        },
        async stop(): Promise<void> {
            stopped = true;
            for (const id of timers.keys()) cancel(id);
            await Promise.allSettled([...inFlight]);
        },
    };
}
