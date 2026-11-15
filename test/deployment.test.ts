import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { SlashCommand } from '../src/commands/types';
import type { Environment } from '../src/config';
import { buildCommandPayload, deployCommands, main, parseDeploymentArguments } from '../src/scripts/deploy-commands';
import type { DeploymentRest } from '../src/scripts/deploy-commands';

const applicationId = '111111111111111111';
const guildId = '222222222222222222';
const token = 'offline-deployment-test-secret';
const credentials: Environment = { TOKEN: token, BOT_CLIENT_ID: applicationId };

function command(name = 'sample'): SlashCommand {
    return {
        name, usage: `/${name}`, category: 'Test', description: 'Internal metadata, not the payload description.', ownerOnly: true,
        data: new SlashCommandBuilder().setName(name).setDescription('Public command description.')
            .addStringOption(option => option.setName('query').setDescription('Search input').setRequired(true)),
        async execute() {},
    };
}

function restFixture(identity: unknown = { id: applicationId }) {
    const calls: { method: 'GET' | 'PUT'; route: string; body?: RESTPostAPIChatInputApplicationCommandsJSONBody[] }[] = [];
    const rest: DeploymentRest = {
        async get(route) { calls.push({ method: 'GET', route }); return identity; },
        async put(route, options) { calls.push({ method: 'PUT', route, body: options.body }); return []; },
    };
    return { rest, calls };
}

test('deployment requires exactly one explicit scope and applies only when requested', () => {
    assert.deepEqual(parseDeploymentArguments(['--global']), { scope: { kind: 'global' }, apply: false });
    assert.deepEqual(parseDeploymentArguments(['--guild', guildId]), { scope: { kind: 'guild', guildId }, apply: false });
    assert.deepEqual(parseDeploymentArguments(['--apply', '--guild', guildId]), { scope: { kind: 'guild', guildId }, apply: true });
    assert.deepEqual(parseDeploymentArguments(['--global', '--apply']), { scope: { kind: 'global' }, apply: true });
    for (const args of [[], ['--apply']]) assert.throws(() => parseDeploymentArguments(args), /explicit scope/);
    for (const args of [
        ['--global', '--guild', guildId], ['--guild', guildId, '--global'],
        ['--global', '--global'], ['--guild', guildId, '--guild', guildId],
    ]) assert.throws(() => parseDeploymentArguments(args), /exactly one deployment scope/);
    assert.throws(() => parseDeploymentArguments(['--global', '--apply', '--apply']), /--apply only once/);
});

test('missing or malformed guild IDs never fall back to global deployment', () => {
    for (const value of ['', '123', '1'.repeat(16), '1'.repeat(21), 'not-a-guild', `${guildId}x`, ` ${guildId}`, '--global', '--apply']) {
        assert.throws(() => parseDeploymentArguments(['--guild', value]), /--guild requires a Discord guild ID/);
    }
    assert.throws(() => parseDeploymentArguments(['--guild']), /--guild requires a Discord guild ID/);
    for (const value of ['--preview', '--unknown', '--global=true', guildId]) {
        assert.throws(() => parseDeploymentArguments(['--global', value]), /Unknown deployment argument/);
    }
    for (const length of [17, 20]) {
        const id = '1'.repeat(length);
        assert.deepEqual(parseDeploymentArguments(['--guild', id]).scope, { kind: 'guild', guildId: id });
    }
});

test('command payloads are exactly builder JSON, without handlers or internal metadata', () => {
    const commands = [command('first'), command('second')];
    const payload = buildCommandPayload(commands);
    assert.deepEqual(payload, commands.map(item => item.data.toJSON()));
    assert.equal(payload[0]?.description, 'Public command description.');
    for (const item of payload) {
        for (const key of ['execute', 'usage', 'category', 'ownerOnly', 'data']) assert.equal(Object.hasOwn(item, key), false);
    }
    assert.deepEqual(buildCommandPayload([]), []);
});

test('payload construction rejects duplicate names and disagreement between metadata and builders', () => {
    assert.throws(() => buildCommandPayload([command(), command()]), /Duplicate slash command: sample/);
    assert.throws(() => buildCommandPayload([{ ...command(), name: 'different' }]), /must match its canonical lowercase metadata name/);
    assert.throws(() => buildCommandPayload([{ ...command(), name: 'SAMPLE' }]), /must match its canonical lowercase metadata name/);
});

test('preview needs no credentials, creates no REST client, and performs no reads or writes', async () => {
    for (const args of [['--global'], ['--guild', guildId]]) {
        const f = restFixture();
        const output: string[] = [];
        let creations = 0;
        await deployCommands(args, {}, {
            commands: [command()], output: message => output.push(message),
            createRest() { creations++; return f.rest; },
        });
        assert.equal(creations, 0);
        assert.deepEqual(f.calls, []);
        assert.equal(output.length, 1);
        const preview: unknown = JSON.parse(output[0]!);
        const payload: unknown = JSON.parse(JSON.stringify([command().data.toJSON()]));
        assert.deepEqual(preview, {
            mode: 'preview', scope: args[0] === '--global' ? 'global' : `guild ${guildId}`,
            commands: payload,
        });
    }
});

test('default preview preserves all three public slash commands without credentials or REST', async () => {
    const output: string[] = [];
    await deployCommands(['--global'], {}, {
        output: value => output.push(value), createRest() { assert.fail('Preview must not construct REST'); },
    });
    const preview: unknown = JSON.parse(output[0]!);
    assert.ok(preview && typeof preview === 'object' && 'commands' in preview);
    assert.ok(Array.isArray(preview.commands));
    const names = preview.commands.map((item: unknown) => {
        assert.ok(item && typeof item === 'object' && 'name' in item);
        return item.name;
    });
    assert.deepEqual(names.sort(), ['calc', 'help', 'ping']);
});

test('apply validates credentials before constructing REST or overwriting commands', async () => {
    const invalid: { env: Environment; message: RegExp }[] = [
        ...[undefined, '', ' ', 'token', 'your-token', 'replace_me', 'example-value', 'private token'].map(value => ({
            env: { BOT_CLIENT_ID: applicationId, ...(value === undefined ? {} : { TOKEN: value }) }, message: /Set TOKEN/,
        })),
        ...[undefined, '', '123', 'invalid', `${applicationId} `, '1'.repeat(21)].map(value => ({
            env: { TOKEN: token, ...(value === undefined ? {} : { BOT_CLIENT_ID: value }) }, message: /Set BOT_CLIENT_ID/,
        })),
    ];
    for (const { env, message } of invalid) {
        let creations = 0;
        await assert.rejects(deployCommands(['--global', '--apply'], env, {
            commands: [command()], output() {}, createRest() { creations++; return restFixture().rest; },
        }), message);
        assert.equal(creations, 0);
    }
});

test('apply checks token identity before replacing only the explicitly selected scope', async () => {
    for (const args of [['--global', '--apply'], ['--guild', guildId, '--apply']]) {
        const f = restFixture();
        const tokens: string[] = [];
        const output: string[] = [];
        await deployCommands(args, { ...credentials, TOKEN: ` ${token} ` }, {
            commands: [command()], output: message => output.push(message),
            createRest(value) { tokens.push(value); return f.rest; },
        });
        assert.deepEqual(tokens, [token]);
        assert.deepEqual(f.calls, [
            { method: 'GET', route: Routes.oauth2CurrentApplication() },
            { method: 'PUT', route: args[0] === '--global' ? Routes.applicationCommands(applicationId) : Routes.applicationGuildCommands(applicationId, guildId), body: [command().data.toJSON()] },
        ]);
        assert.equal(output.length, 1);
        assert.ok(output[0]?.includes(applicationId));
        assert.equal(output.join().includes(token), false);
    }
});

test('mismatched or malformed application identity never reaches PUT', async () => {
    for (const identity of [{ id: guildId }, { id: Number(applicationId) }, {}, null, applicationId]) {
        const f = restFixture(identity);
        const output: string[] = [];
        await assert.rejects(deployCommands(['--global', '--apply'], credentials, {
            commands: [command()], createRest: () => f.rest, output: value => output.push(value),
        }), /different application/);
        assert.deepEqual(f.calls, [{ method: 'GET', route: Routes.oauth2CurrentApplication() }]);
        assert.deepEqual(output, []);
    }
});

test('GET and PUT failures propagate without a write after failed identity or a success announcement', async () => {
    for (const stage of ['GET', 'PUT']) {
        const failure = new Error(`Private ${stage} failure ${token}`);
        const f = restFixture();
        if (stage === 'GET') f.rest.get = async route => { f.calls.push({ method: 'GET', route }); throw failure; };
        else f.rest.put = async (route, options) => { f.calls.push({ method: 'PUT', route, body: options.body }); throw failure; };
        const output: string[] = [];
        await assert.rejects(deployCommands(['--guild', guildId, '--apply'], credentials, {
            commands: [command()], createRest: () => f.rest, output: value => output.push(value),
        }), (error: unknown) => error === failure);
        assert.deepEqual(f.calls.map(call => call.method), stage === 'GET' ? ['GET'] : ['GET', 'PUT']);
        assert.deepEqual(output, []);
    }
});

test('CLI boundary catches rejected PUT, returns failure, and redacts upstream secrets', async t => {
    const previousArgv = process.argv;
    const previousEnvironment = { ...process.env };
    const previousExitCode = process.exitCode;
    const errors: unknown[][] = [];
    const get = t.mock.method(REST.prototype, 'get', async () => ({ id: applicationId }));
    const put = t.mock.method(REST.prototype, 'put', async () => { throw new Error(`Discord rejected ${token} https://private.example`); });
    t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args); });
    try {
        process.env.TOKEN = token;
        process.env.BOT_CLIENT_ID = applicationId;
        process.argv = ['node', 'deploy-commands.js', '--global', '--apply'];
        process.exitCode = undefined;
        await main();
        assert.equal(process.exitCode, 1);
        assert.equal(get.mock.callCount(), 1);
        assert.equal(put.mock.callCount(), 1);
        assert.deepEqual(errors, [['[Deploy] Deployment failed. Check the token, application ID, permissions, and Discord connectivity. No automatic retry was attempted.']]);
    } finally {
        process.argv = previousArgv;
        process.exitCode = previousExitCode;
        for (const key of Object.keys(process.env)) if (!Object.hasOwn(previousEnvironment, key)) delete process.env[key];
        Object.assign(process.env, previousEnvironment);
    }
});
