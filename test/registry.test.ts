import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApplicationCommandOptionType, Client, REST, SlashCommandBuilder } from 'discord.js';
import mongoose from 'mongoose';
import type { PrefixCommand, SlashCommand } from '../src/commands/types';
import { parsePrefixCommand } from '../src/events';

const expectedPrefix = [
    { name: 'help', aliases: ['h', 'commands'], ownerOnly: false },
    { name: 'info', aliases: ['i', 'information'], ownerOnly: false },
    { name: 'list', aliases: ['cmd', 'ls'], ownerOnly: false },
    { name: 'ping', aliases: ['pong', 'latency'], ownerOnly: false },
    { name: 'avatar', aliases: ['av', 'profile', 'pfp'], ownerOnly: false },
    { name: 'calc', aliases: ['calculate', 'c'], ownerOnly: false },
    { name: 'time', aliases: [], ownerOnly: false },
    { name: 'claim', aliases: [], ownerOnly: false },
    { name: 'lock', aliases: ['l'], ownerOnly: false },
    { name: 'unlock', aliases: ['ul'], ownerOnly: false },
    { name: 'whitelist', aliases: ['wl', 'invite'], ownerOnly: false },
    { name: 'blacklist', aliases: ['bl', 'uninvite'], ownerOnly: false },
    { name: 'pin', aliases: ['p'], ownerOnly: false },
    { name: 'unpin', aliases: ['unp'], ownerOnly: false },
    { name: 'pinscount', aliases: ['pc'], ownerOnly: false },
    { name: 'create-channel', aliases: ['createch', 'newch'], ownerOnly: true },
    { name: 'upgrade', aliases: ['up', 'upg'], ownerOnly: false },
    { name: '2iFTIvcy6', aliases: [], ownerOnly: true },
    { name: '6nhEqa0jM3', aliases: [], ownerOnly: true },
    { name: 'gstart', aliases: ['ga'], ownerOnly: true },
    { name: 'patthearifin', aliases: ['petthearifin', 'arifin', 'afn'], ownerOnly: false },
    { name: 'resetpos', aliases: ['rp'], ownerOnly: true },
    { name: 'echo', aliases: ['repeat'], ownerOnly: true },
    { name: 'run', aliases: ['exec', 'execute'], ownerOnly: true },
    { name: 'restart', aliases: ['rs'], ownerOnly: true },
    { name: 'shutdown', aliases: ['sd'], ownerOnly: true },
    { name: 'test', aliases: [], ownerOnly: false },
    { name: 'turu', aliases: [], ownerOnly: false },
];

function loadRegistry() {
    // Static imports would run registry initialization before the first test's network guards.
    return import('../src/commands/registry.js');
}

function prefix(name = 'sample', aliases: readonly string[] = []): PrefixCommand {
    return { name, aliases, usage: `sm ${name}`, category: 'Test', description: 'Test command', ownerOnly: false, async execute() {} };
}

function slash(name = 'sample'): SlashCommand {
    return {
        name, usage: `/${name}`, category: 'Test', description: 'Test command', ownerOnly: false,
        data: new SlashCommandBuilder().setName(name).setDescription('Test command'), async execute() {},
    };
}

test('importing and constructing the runtime registry does not log in, connect a database, or deploy', async t => {
    const login = t.mock.method(Client.prototype, 'login', async () => { assert.fail('Registry must not log in'); });
    const connect = t.mock.method(mongoose, 'connect', async () => { assert.fail('Registry must not connect a database'); });
    const get = t.mock.method(REST.prototype, 'get', async () => { assert.fail('Registry must not make REST reads'); });
    const put = t.mock.method(REST.prototype, 'put', async () => { assert.fail('Registry must not deploy commands'); });
    const { createRuntimeRegistry } = await loadRegistry();
    const first = createRuntimeRegistry(null);
    const second = createRuntimeRegistry(null);
    assert.equal(first.prefix.length, 28);
    assert.equal(first.slash.length, 3);
    assert.notEqual(first.prefixLookup, second.prefixLookup);
    assert.notEqual(first.slashLookup, second.slashLookup);
    assert.equal(login.mock.callCount(), 0);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(get.mock.callCount(), 0);
    assert.equal(put.mock.callCount(), 0);
});

test('runtime registry preserves the exact 28 canonical prefix names, every alias, and owner access', async () => {
    const { createRuntimeRegistry } = await loadRegistry();
    const registry = createRuntimeRegistry(null);
    const actual = registry.prefix.map(({ name, aliases, ownerOnly }) => ({ name, aliases: [...aliases], ownerOnly }));
    const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name);
    assert.deepEqual(actual.sort(byName), [...expectedPrefix].sort(byName));
    assert.equal(registry.prefix.length, 28);
    assert.equal(new Set(registry.prefix).size, 28);
    assert.equal(registry.prefixLookup.size, expectedPrefix.reduce((count, item) => count + 1 + item.aliases.length, 0));
    for (const item of registry.prefix) {
        assert.equal(typeof item.execute, 'function');
        assert.ok(item.usage.length > 0, item.name);
        assert.ok(item.category.length > 0, item.name);
        assert.ok(item.description.length > 0, item.name);
    }
});

test('prefix parsing routes every canonical name and alias case-insensitively to its canonical command', async () => {
    const { createRuntimeRegistry } = await loadRegistry();
    const registry = createRuntimeRegistry(null);
    for (const expected of expectedPrefix) {
        const canonical = registry.prefix.find(item => item.name === expected.name);
        assert.ok(canonical, expected.name);
        for (const name of [expected.name, ...expected.aliases]) {
            for (const spelling of [name, name.toLowerCase(), name.toUpperCase()]) {
                const parsed = parsePrefixCommand(`SM ${spelling} One Two`, 'sm ');
                assert.ok(parsed, spelling);
                assert.deepEqual(parsed.args, ['One', 'Two']);
                assert.equal(registry.prefixLookup.get(parsed.name), canonical, spelling);
            }
        }
    }
    for (const name of ['2iFTIvcy6', '6nhEqa0jM3']) {
        const parsed = parsePrefixCommand(`sm ${name}`, 'sm ');
        assert.ok(parsed);
        assert.equal(registry.prefixLookup.get(parsed.name)?.name, name);
    }
    assert.equal(registry.prefixLookup.get('unknown-command'), undefined);
});

test('runtime slash registry preserves the three canonical commands and their option contracts', async () => {
    const { createRuntimeRegistry } = await loadRegistry();
    const registry = createRuntimeRegistry(null);
    assert.deepEqual(registry.slash.map(item => item.name).sort(), ['calc', 'help', 'ping']);
    assert.equal(registry.slash.length, 3);
    assert.equal(registry.slashLookup.size, 3);
    for (const item of registry.slash) {
        assert.equal(registry.slashLookup.get(item.name), item);
        assert.equal(item.ownerOnly, false);
        assert.equal(typeof item.execute, 'function');
        assert.equal(item.data.toJSON().name, item.name);
    }
    const help = registry.slashLookup.get('help')?.data.toJSON();
    const calc = registry.slashLookup.get('calc')?.data.toJSON();
    const ping = registry.slashLookup.get('ping')?.data.toJSON();
    assert.ok(help && calc && ping);
    assert.equal(help.options?.length, 1);
    assert.equal(calc.options?.length, 1);
    assert.deepEqual(help.options?.map(option => ({ name: option.name, type: option.type, required: 'required' in option ? option.required : undefined })), [
        { name: 'command', type: ApplicationCommandOptionType.String, required: false },
    ]);
    assert.deepEqual(calc.options?.map(option => ({ name: option.name, type: option.type, required: 'required' in option ? option.required : undefined })), [
        { name: 'expression', type: ApplicationCommandOptionType.String, required: true },
    ]);
    assert.deepEqual(ping.options ?? [], []);
});

test('registry rejects case-insensitive canonical and alias collisions, including the mixed-case legacy names', async () => {
    const { createCommandRegistry } = await loadRegistry();
    const collisions: PrefixCommand[][] = [
        [prefix('sample'), prefix('SAMPLE')],
        [prefix('first', ['shortcut']), prefix('SHORTCUT')],
        [prefix('shortcut'), prefix('second', ['SHORTCUT'])],
        [prefix('first', ['shortcut']), prefix('second', ['SHORTCUT'])],
        [prefix('sample', ['SAMPLE'])],
        [prefix('sample', ['shortcut', 'SHORTCUT'])],
        [prefix('2iFTIvcy6'), prefix('2IFTIVCY6')],
        [prefix('6nhEqa0jM3'), prefix('other', ['6NHEQA0JM3'])],
    ];
    for (const commands of collisions) {
        assert.throws(() => createCommandRegistry(commands, []), /Duplicate prefix command name or alias/);
    }
    assert.throws(() => createCommandRegistry([], [slash(), slash()]), /Duplicate slash command name/);
    assert.throws(() => createCommandRegistry([], [{ ...slash(), name: 'different' }]), /metadata and payload disagree/);
});

test('registry keeps canonical arrays separate from lookup aliases and caller mutations', async () => {
    const { createCommandRegistry } = await loadRegistry();
    const command = prefix('MiXeD', ['first', 'SECOND']);
    const slashCommand = slash('mixed');
    const prefixInput = [command];
    const slashInput = [slashCommand];
    const registry = createCommandRegistry(prefixInput, slashInput);
    prefixInput.length = 0;
    slashInput.length = 0;
    assert.deepEqual(registry.prefix, [command]);
    assert.deepEqual(registry.slash, [slashCommand]);
    assert.equal(registry.prefixLookup.size, 3);
    for (const key of ['mixed', 'first', 'second']) assert.equal(registry.prefixLookup.get(key), command);
    assert.equal(registry.slashLookup.get('mixed'), slashCommand);
});

test('registry rejects empty and whitespace-bearing names or aliases instead of registering unreachable commands', async () => {
    const { createCommandRegistry } = await loadRegistry();
    for (const name of ['', 'two words', 'tab\tname', '\nname']) {
        assert.throws(() => createCommandRegistry([prefix(name)], []), /Invalid prefix command name/);
        assert.throws(() => createCommandRegistry([prefix('sample', [name])], []), /Invalid prefix command name/);
        assert.throws(() => createCommandRegistry([], [{ ...slash(), name }]), /Invalid slash command name/);
    }
});
