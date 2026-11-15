import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, ClientUser, Events } from 'discord.js';
import { createApplication, createLifecycle, describeRuntimeError, validateRuntimeToken } from '../src/app';
import { loadConfig } from '../src/config';
import type { ApplicationOptions } from '../src/app';

class OfflineUser extends ClientUser {
    constructor(client: Client<true>) {
        super(client, { id: '953610843692617788', username: 'offline', global_name: null, discriminator: '0000', avatar: null, bot: true });
    }
}

function fixture() {
    const client = new Client<true>({ intents: [] });
    client.user = new OfflineUser(client);
    const calls: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const destroy = client.destroy.bind(client);
    client.destroy = async () => { calls.push('destroy'); await destroy(); };
    client.login = async () => {
        calls.push('login');
        client.emit(Events.ClientReady, client);
        return 'offline-result';
    };
    const database = {
        async connect() { calls.push('connect'); },
        async initializeGiveaways() { calls.push('indexes'); },
        async disconnect() { calls.push('disconnect'); },
    };
    const options: ApplicationOptions = {
        client, database,
        logger: { info() {}, warn(message) { warnings.push(message); }, error(message) { errors.push(message); } },
        drainPermissions: async () => { calls.push('permissions'); },
    };
    const config = loadConfig({ TOKEN: 'offline-unit-credential' });
    return { client, calls, warnings, errors, database, options, config };
}

test('lifecycle unregister and repeated cleanup are idempotent, including rejected cleanups', async () => {
    const lifecycle = createLifecycle();
    const calls: string[] = [];
    const remove = lifecycle.registerCleanup(() => { calls.push('removed'); });
    remove();
    remove();
    lifecycle.registerCleanup(() => { calls.push('first'); throw new Error('cleanup failed'); });
    lifecycle.registerCleanup(() => { calls.push('second'); });
    const cleanup = lifecycle.cleanup();
    assert.equal(lifecycle.accepting, false);
    assert.equal(lifecycle.cleanup(), cleanup);
    await assert.rejects(cleanup, AggregateError);
    assert.deepEqual(calls, ['first', 'second']);
    lifecycle.registerCleanup(() => { calls.push('late'); });
    await lifecycle.drain();
    assert.deepEqual(calls, ['first', 'second', 'late']);
});

test('lifecycle drains settled, rejected, and newly tracked work without dropping later tasks', async () => {
    const lifecycle = createLifecycle();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const rejected = Promise.reject(new Error('expected command rejection'));
    assert.equal(lifecycle.track(rejected), rejected);
    await assert.rejects(rejected, /expected command rejection/);
    assert.equal(await lifecycle.track(Promise.resolve(42)), 42);
    const firstTracked = lifecycle.track(first.promise);
    let finished = false;
    const drain = lifecycle.drain().then(() => { finished = true; });
    const secondTracked = lifecycle.track(second.promise);
    first.resolve();
    await firstTracked;
    await Promise.resolve();
    assert.equal(finished, false);
    second.resolve();
    await secondTracked;
    await drain;
    assert.equal(finished, true);
    lifecycle.stopIntake();
    lifecycle.stopIntake();
    assert.equal(lifecycle.accepting, false);
    await lifecycle.cleanup();
});

test('application construction does not log in and missing MongoDB is an explicit optional mode', async () => {
    const f = fixture();
    const app = createApplication(f.config, f.options);
    assert.deepEqual(f.calls, []);
    try {
        const startup = app.start();
        assert.equal(app.start(), startup);
        await startup;
        assert.deepEqual(f.calls, ['login']);
        assert.equal(f.warnings.length, 1);
        assert.match(f.warnings[0]!, /MONGODB is unset/);
        assert.ok(app.context.registry.prefixLookup.has('help'));
    } finally { await app.stop(); }
    assert.deepEqual(f.calls, ['login', 'permissions', 'destroy']);
    assert.equal(f.client.listenerCount(Events.MessageCreate), 0);
});

test('database connection and indexes complete before login and failed startup never logs in', async () => {
    for (const failure of ['none', 'connect', 'indexes']) {
        const f = fixture();
        const config = { ...f.config, MongoPath: 'mongodb://offline.invalid/unit' };
        const connected = Promise.withResolvers<void>();
        const indexed = Promise.withResolvers<void>();
        const connecting = Promise.withResolvers<void>();
        const indexing = Promise.withResolvers<void>();
        f.database.connect = async () => {
            f.calls.push('connect'); connecting.resolve(); await connected.promise;
            if (failure === 'connect') throw new Error('private database URI');
        };
        f.database.initializeGiveaways = async () => {
            f.calls.push('indexes'); indexing.resolve(); await indexed.promise;
            if (failure === 'indexes') throw new Error('private index failure');
        };
        const app = createApplication(config, {
            ...f.options,
            giveaways: () => ({
                async start() { f.calls.push('giveaways'); return []; },
                async stop() { f.calls.push('giveaways-stop'); },
                async create() { throw new Error('unused'); },
                async toggleEntry() { throw new Error('unused'); },
                async end() { throw new Error('unused'); },
                async reroll() { throw new Error('unused'); },
            }),
        });
        const startup = app.start();
        const observed = startup.catch((error: unknown) => error);
        await connecting.promise;
        assert.deepEqual(f.calls, ['connect']);
        connected.resolve();
        if (failure !== 'connect') {
            await indexing.promise;
            assert.deepEqual(f.calls, ['connect', 'indexes']);
        }
        indexed.resolve();
        const result: unknown = await observed;
        if (failure === 'none') {
            assert.equal(result, undefined);
            assert.deepEqual(f.calls, ['connect', 'indexes', 'login', 'giveaways']);
            await app.stop();
        } else {
            assert.ok(result instanceof Error);
            assert.equal(f.calls.includes('login'), false);
            assert.ok(f.calls.includes('destroy'));
            assert.ok(f.calls.includes('disconnect'));
            await assert.rejects(app.stop(), AggregateError);
        }
    }
});

test('stop during database startup waits for startup before disconnect and prevents login', async () => {
    const f = fixture();
    const connected = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    f.database.connect = async () => { f.calls.push('connect'); entered.resolve(); await connected.promise; };
    const app = createApplication({ ...f.config, MongoPath: 'mongodb://offline.invalid/unit' }, f.options);
    const startup = app.start();
    const rejected = assert.rejects(startup, /stopped during database startup/);
    await entered.promise;
    const stopping = app.stop();
    assert.equal(app.stop(), stopping);
    assert.equal(app.lifecycle.accepting, false);
    assert.equal(f.calls.includes('disconnect'), false);
    connected.resolve();
    await stopping;
    await rejected;
    assert.equal(f.calls.includes('login'), false);
    assert.ok(f.calls.indexOf('indexes') < f.calls.indexOf('disconnect'));
});

test('collector cleanup releases command promises before permission drain and disconnect', async () => {
    const f = fixture();
    const app = createApplication(f.config, f.options);
    const command = Promise.withResolvers<void>();
    const trackedCommand = app.lifecycle.track(command.promise.then(() => { f.calls.push('command-settled'); }));
    app.lifecycle.registerCleanup(() => { f.calls.push('collector-cleanup'); command.resolve(); });
    await app.stop();
    await app.stop();
    await trackedCommand;
    assert.deepEqual(f.calls, ['collector-cleanup', 'command-settled', 'permissions', 'destroy']);
    await assert.rejects(app.start(), /stopping/);
});

test('shutdown bounds hung collector work without a real credential or timer sleeps', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const f = fixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const destroyed = Promise.withResolvers<void>();
    const destroy = f.client.destroy.bind(f.client);
    f.client.destroy = async () => { await destroy(); destroyed.resolve(); };
    const app = createApplication(f.config, { ...f.options, shutdownTimeoutMs: 20 });
    app.lifecycle.registerCleanup(async () => { entered.resolve(); await release.promise; });
    const stopping = app.stop();
    const rejected = assert.rejects(stopping, AggregateError);
    await entered.promise;
    t.mock.timers.tick(20);
    await destroyed.promise;
    await rejected;
    assert.ok(f.calls.includes('destroy'));
    release.resolve();
    await app.lifecycle.cleanup();
});

test('ready and reconnect never register commands with Discord', async () => {
    const f = fixture();
    const requests: unknown[] = [];
    f.client.rest.put = async (...args) => { requests.push(args); throw new Error('REST must remain offline'); };
    const app = createApplication(f.config, f.options);
    try {
        await app.start();
        f.client.emit(Events.ClientReady, f.client);
        f.client.emit(Events.ShardResume, 0, 1);
        await app.lifecycle.drain();
        assert.deepEqual(requests, []);
    } finally { await app.stop(); }
});

test('credential and diagnostic boundaries reject placeholders and never expose error details', () => {
    for (const token of [undefined, '', 'TOKEN', 'your-token', 'placeholder-secret', 'has whitespace']) {
        assert.throws(() => validateRuntimeToken(token), /Set TOKEN/);
    }
    const secret = 'mongodb://name:password@private.invalid';
    assert.equal(describeRuntimeError(new Error(secret)), 'Error');
    assert.equal(describeRuntimeError({ message: secret }), 'Unknown error');
    assert.equal(describeRuntimeError(new Error(`Invalid configuration: MONGODB ${secret}`)), 'Invalid configuration: MONGODB');
});
