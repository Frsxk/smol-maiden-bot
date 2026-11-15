import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'discord.js';
import type { APIEmbed, InteractionEditReplyOptions, InteractionReplyOptions, MessageReplyOptions } from 'discord.js';
import { executePrefixHelp, executeSlashHelp, executeSlashPing, prefixCommands, slashCommands } from '../src/commands/bot';
import type { HelpMessage, HelpInteraction, PingInteraction } from '../src/commands/bot';
import type { AppContext, PrefixCommand } from '../src/commands/types';
import { loadConfig } from '../src/config';

function context(prefix = 'sm '): AppContext {
    const hidden: PrefixCommand = {
        name: 'private-command', aliases: [], usage: 'private-command', category: 'lmao',
        description: 'Owner command', ownerOnly: true, async execute() {},
    };
    const commands = [...prefixCommands, hidden];
    return {
        client: new Client({ intents: [] }),
        config: { ...loadConfig({}), botPrefix: prefix },
        registry: {
            prefix: commands, slash: slashCommands,
            prefixLookup: new Map(commands.flatMap(command => [command.name, ...command.aliases].map(name => [name, command] as const))),
            slashLookup: new Map(slashCommands.map(command => [command.name, command])),
        },
        lifecycle: { track: promise => promise, registerCleanup: () => () => {} },
    };
}

function embedOf(options: MessageReplyOptions | InteractionReplyOptions | InteractionEditReplyOptions): APIEmbed {
    const embed = options.embeds?.[0];
    assert.ok(embed);
    return 'toJSON' in embed ? embed.toJSON() : embed;
}

function prefixReply() {
    const replies: MessageReplyOptions[] = [];
    const message: HelpMessage = { author: { id: 'visitor' }, async reply(options) { replies.push(options); } };
    return { message, replies };
}

function slashReply(name: string | null = null) {
    const replies: InteractionReplyOptions[] = [];
    const interaction: HelpInteraction = {
        user: { id: 'dm-visitor' }, options: { getString: () => name },
        async reply(options) { replies.push(options); },
    };
    return { interaction, replies };
}

test('prefix overview replies once without needing guild or member and counts commands, not aliases or private categories', async () => {
    const f = prefixReply();
    await executePrefixHelp(context(), f.message, []);
    assert.equal(f.replies.length, 1);
    const embed = embedOf(f.replies[0]!);
    assert.ok(embed.description?.includes('`sm help <command>`'));
    assert.ok(embed.description?.includes('**Prefix commands:** 4\n**Slash commands:** 2'));
    assert.equal(embed.description?.includes('sm  help'), false);
    assert.equal(JSON.stringify(embed).includes('private-command'), false);
    assert.deepEqual(f.replies[0]?.allowedMentions, { repliedUser: false });
});

test('prefix help resolves mixed-case canonical names and aliases with original metadata', async () => {
    for (const name of ['HELP', 'CoMmAnDs', 'H']) {
        const f = prefixReply();
        await executePrefixHelp(context(), f.message, [name]);
        assert.equal(f.replies.length, 1);
        const embed = embedOf(f.replies[0]!);
        assert.equal(embed.title, 'Smol Maiden Help | `help` Command');
        assert.equal(embed.fields?.find(field => field.name === 'Aliases')?.value, '`h`, `commands`');
        assert.equal(embed.fields?.find(field => field.name === 'Usage')?.value, '`sm help <command>`');
    }
});

test('unknown prefix help preserves the supplied name and concatenates configured prefix exactly', async () => {
    for (const prefix of ['sm ', '!']) {
        const f = prefixReply();
        await executePrefixHelp(context(prefix), f.message, ['MiSsInG']);
        assert.equal(f.replies.length, 1);
        assert.equal(f.replies[0]?.content, `I don't have a command called \`MiSsInG\`. Run \`${prefix}help\` to see everything I can do.`);
        assert.deepEqual(f.replies[0]?.allowedMentions, { parse: [], repliedUser: false });
    }
});

test('slash help overview works without a member or guild and hides private categories from counts', async () => {
    const f = slashReply();
    await executeSlashHelp(context(), f.interaction);
    assert.equal(f.replies.length, 1);
    const embed = embedOf(f.replies[0]!);
    assert.ok(embed.description?.includes('<@dm-visitor>'));
    assert.ok(embed.description?.includes('**Prefix commands:** 4\n**Slash commands:** 2'));
    assert.deepEqual(embed.fields?.map(field => field.name), ['🤖 - Bot Slash Commands', '🛠 - Utility Slash Commands']);
});

test('slash help resolves mixed case and acknowledges unknown commands once', async () => {
    const known = slashReply('PiNg');
    await executeSlashHelp(context(), known.interaction);
    assert.equal(known.replies.length, 1);
    assert.equal(embedOf(known.replies[0]!).title, 'Smol Maiden Help | `ping` Slash Command');
    const unknown = slashReply('MiSsInG');
    await executeSlashHelp(context(), unknown.interaction);
    assert.equal(unknown.replies.length, 1);
    assert.deepEqual(unknown.replies[0], { content: 'I don\'t have a slash command called "MiSsInG".', allowedMentions: { parse: [] } });
});

test('slash ping acknowledges exactly once, fetches the acknowledged response and edits it', async () => {
    const calls: string[] = [];
    const edits: InteractionEditReplyOptions[] = [];
    const interaction: PingInteraction = {
        createdTimestamp: 1000,
        async reply(options) { calls.push('reply'); assert.deepEqual(options, { content: '🏓 Pinging...' }); },
        async fetchReply() { calls.push('fetch'); return { createdTimestamp: 1042 }; },
        async editReply(options) { calls.push('edit'); edits.push(options); },
    };
    await executeSlashPing(context(), interaction);
    assert.deepEqual(calls, ['reply', 'fetch', 'edit']);
    assert.equal(edits[0]?.content, null);
    assert.equal(embedOf(edits[0]).fields?.find(field => field.name === 'Time')?.value, '42ms');
});

test('slash ping never retries acknowledgement after a response failure', async () => {
    for (const failure of ['reply', 'fetch', 'edit']) {
        const calls: string[] = [];
        const error = new Error(failure);
        function record(step: string): void { calls.push(step); if (step === failure) throw error; }
        const interaction: PingInteraction = {
            createdTimestamp: 1000,
            async reply() { record('reply'); },
            async fetchReply() { record('fetch'); return { createdTimestamp: 1042 }; },
            async editReply() { record('edit'); },
        };
        await assert.rejects(executeSlashPing(context(), interaction), error);
        assert.deepEqual(calls, ['reply', 'fetch', 'edit'].slice(0, ['reply', 'fetch', 'edit'].indexOf(failure) + 1));
    }
});
