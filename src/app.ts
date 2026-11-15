import { Client, GatewayIntentBits } from 'discord.js';
import { connectDatabase, disconnectDatabase } from './database/connection';
import { Giveaway, createMongooseGiveawayStore } from './database/giveaway';
import { createCommandRegistry, createRuntimeRegistry } from './commands/registry';
import type { AppContext, AppLifecycle } from './commands/types';
import type { BotConfig } from './config';
import { drainChannelLocks } from './features/channel-manager/channel-lock';
import { createDiscordGiveawayTransport } from './features/giveaways/discord';
import { createGiveawayService } from './features/giveaways/service';
import type { GiveawayLocation, GiveawayService } from './features/giveaways/service';
import { registerEvents, safeAllowedMentions } from './events';
import type { RuntimeLogger } from './events';

export interface ManagedLifecycle extends AppLifecycle {
    readonly accepting: boolean;
    stopIntake(): void;
    cleanup(): Promise<void>;
    drain(): Promise<void>;
}

export function createLifecycle(): ManagedLifecycle {
    const tasks = new Set<Promise<unknown>>();
    const cleanups = new Set<() => void | Promise<void>>();
    let accepting = true;
    let cleaning: Promise<void> | undefined;
    function track<T>(task: Promise<T>): Promise<T> {
        tasks.add(task);
        void task.then(() => tasks.delete(task), () => tasks.delete(task));
        return task;
    }
    return {
        get accepting() { return accepting; },
        stopIntake() { accepting = false; },
        track,
        registerCleanup(cleanup) {
            if (!accepting) {
                void track(Promise.resolve().then(cleanup)).catch(() => {});
                return () => {};
            }
            cleanups.add(cleanup);
            return () => { cleanups.delete(cleanup); };
        },
        cleanup() {
            accepting = false;
            cleaning ??= (async () => {
                const pending = [...cleanups];
                cleanups.clear();
                const results = await Promise.allSettled(pending.map(callback => Promise.resolve().then(callback)));
                const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
                if (errors.length) throw new AggregateError(errors, 'Lifecycle cleanup failed.');
            })();
            return cleaning;
        },
        async drain() {
            while (tasks.size) await Promise.allSettled([...tasks]);
        },
    };
}

export function validateRuntimeToken(token: string | undefined): string {
    if (!token || /\s/.test(token) || /^(?:your[-_ ]|replace[-_ ]|changeme|example|placeholder|token$)/i.test(token)) {
        throw new Error('Set TOKEN to a real bot token before starting or applying a deployment.');
    }
    return token;
}

export function parseGiveawayLocations(value: string | undefined): Readonly<Record<string, GiveawayLocation>> {
    if (value === undefined) return {};
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { throw new Error('Invalid configuration: GIVEAWAY_LOCATIONS_JSON must be a JSON object.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid configuration: GIVEAWAY_LOCATIONS_JSON must be a JSON object.');
    }
    const result: Record<string, GiveawayLocation> = Object.create(null) as Record<string, GiveawayLocation>;
    for (const [messageId, location] of Object.entries(parsed)) {
        if (!/^\d{17,20}$/.test(messageId) || !location || typeof location !== 'object' || Array.isArray(location)) {
            throw new Error('Invalid configuration: GIVEAWAY_LOCATIONS_JSON message ID or location.');
        }
        const guildId: unknown = Reflect.get(location, 'guildId');
        const channelId: unknown = Reflect.get(location, 'channelId');
        if (typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)
            || typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId)) {
            throw new Error('Invalid configuration: GIVEAWAY_LOCATIONS_JSON guildId/channelId.');
        }
        result[messageId] = { guildId, channelId };
    }
    return result;
}

export function describeRuntimeError(error: unknown): string {
    if (!(error instanceof Error)) return 'Unknown error';
    const invalidField = /^Invalid configuration: ([A-Z_]+)(?:$|[ .])/.exec(error.message)?.[1];
    if (invalidField) return `Invalid configuration: ${invalidField}`;
    if (error.message === 'Set TOKEN to a real bot token before starting or applying a deployment.') return error.message;
    const code: unknown = Reflect.get(error, 'code');
    return `${error.name.replace(/[^\w]/g, '') || 'Error'}${typeof code === 'number' || (typeof code === 'string' && /^[\w-]{1,40}$/.test(code)) ? ` (${code})` : ''}`;
}

async function bounded(task: Promise<unknown>, milliseconds: number, operation: string): Promise<void> {
    const { promise, reject } = Promise.withResolvers<never>();
    const timer = setTimeout(() => { reject(new Error(`${operation} timed out.`)); }, Math.max(1, milliseconds));
    try {
        await Promise.race([task, promise]);
    } finally {
        clearTimeout(timer);
    }
}

export interface ApplicationOptions {
    readonly logger?: RuntimeLogger;
    readonly legacyLocations?: Readonly<Record<string, GiveawayLocation>>;
    readonly shutdownTimeoutMs?: number;
    readonly client?: Client;
    readonly database?: { connect(uri: string): Promise<void>; initializeGiveaways(): Promise<void>; disconnect(): Promise<void> };
    readonly giveaways?: (client: Client, locations: Readonly<Record<string, GiveawayLocation>>, logger: RuntimeLogger) => GiveawayService;
    readonly drainPermissions?: () => Promise<void>;
}

export interface Application {
    readonly context: AppContext;
    readonly lifecycle: ManagedLifecycle;
    start(): Promise<void>;
    stop(): Promise<void>;
}

export function createApplication(config: BotConfig, options: ApplicationOptions = {}): Application {
    const token = validateRuntimeToken(config.token);
    const logger = options.logger ?? console;
    const client = options.client ?? new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
        allowedMentions: safeAllowedMentions,
    });
    const lifecycle = createLifecycle();
    const database = options.database ?? {
        connect: connectDatabase,
        async initializeGiveaways() { await Giveaway.init(); },
        disconnect: disconnectDatabase,
    };
    const context: { client: Client; config: BotConfig; registry: AppContext['registry']; lifecycle: ManagedLifecycle } = {
        client, config, registry: createCommandRegistry([], []), lifecycle,
    };
    let giveaways: GiveawayService | null = null;
    let startTask: Promise<void> | undefined;
    let stopTask: Promise<void> | undefined;
    let removeEvents = () => {};
    let databaseAttempted = false;
    let databaseStartup: Promise<void> | undefined;
    const ready = Promise.withResolvers<void>();
    // Startup owns this rejection; stopping before readiness must not leave a rejection unobserved.
    void ready.promise.catch(() => {});
    function reportError(operation: string, error: unknown): void {
        logger.error(`[${operation}] ${describeRuntimeError(error)}. Check bot permissions, configuration, and service connectivity.`);
    }
    const application: Application = {
        context, lifecycle,
        start() {
            startTask ??= (async () => {
                if (!lifecycle.accepting) throw new Error('Application is stopping.');
                const mongoPath = config.MongoPath;
                if (mongoPath) {
                    databaseAttempted = true;
                    databaseStartup = (async () => {
                        await database.connect(mongoPath);
                        await database.initializeGiveaways();
                    })();
                    await databaseStartup;
                    if (!lifecycle.accepting) throw new Error('Application stopped during database startup.');
                    giveaways = options.giveaways
                        ? options.giveaways(client, options.legacyLocations ?? {}, logger)
                        : createGiveawayService({
                            store: createMongooseGiveawayStore(), transport: createDiscordGiveawayTransport(client),
                            legacyLocations: options.legacyLocations ?? {},
                            diagnostic(event) {
                                logger.warn(`[Giveaway ${event.messageId}] ${event.code}. Check GIVEAWAY_LOCATIONS_JSON and bot access; the stored record is retained.`);
                            },
                        });
                } else logger.warn('[MongoDB] MONGODB is unset. Channel Manager persistence and giveaways are disabled.');
                context.registry = createRuntimeRegistry(giveaways);
                removeEvents = registerEvents(context, {
                    giveaways, accepting: () => lifecycle.accepting, logger, reportError,
                    readyFailed: ready.reject,
                    async ready() {
                        try {
                            if (giveaways) await giveaways.start();
                            ready.resolve();
                        } catch (error) { ready.reject(error); throw error; }
                    },
                });
                if (!lifecycle.accepting) throw new Error('Application stopped before login.');
                await client.login(token);
                await ready.promise;
            })().catch(async (error: unknown) => {
                try { await application.stop(); } catch (stopError) { reportError('Startup cleanup', stopError); }
                throw error;
            });
            return startTask;
        },
        stop() {
            stopTask ??= (async () => {
                lifecycle.stopIntake();
                removeEvents();
                ready.reject(new Error('Application stopped before readiness.'));
                const giveawayStop = giveaways?.stop();
                if (giveawayStop) void giveawayStop.catch(() => {});
                const timeout = options.shutdownTimeoutMs ?? 15000;
                const deadline = Date.now() + timeout;
                const remaining = () => Math.max(1, deadline - Date.now());
                const failures: unknown[] = [];
                try {
                    // Collector cleanup releases game promises before draining command handlers.
                    await bounded(lifecycle.cleanup(), remaining(), 'Collector cleanup');
                } catch (error) { failures.push(error); }
                try {
                    await bounded((async () => {
                        await lifecycle.drain();
                        await (options.drainPermissions ?? drainChannelLocks)();
                        await giveawayStop;
                    })(), remaining(), 'Operation drain');
                } catch (error) { failures.push(error); }
                try { await bounded(Promise.resolve(client.destroy()), remaining(), 'Discord disconnect'); }
                catch (error) { failures.push(error); }
                if (databaseAttempted) {
                    if (databaseStartup) {
                        try { await bounded(databaseStartup, remaining(), 'Database startup drain'); }
                        catch (error) { failures.push(error); }
                    }
                    try { await bounded(database.disconnect(), remaining(), 'Database disconnect'); }
                    catch (error) { failures.push(error); }
                }
                if (failures.length) throw new AggregateError(failures, 'Shutdown failed to finish cleanly.');
            })();
            return stopTask;
        },
    };
    return application;
}
