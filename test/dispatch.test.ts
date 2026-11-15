import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelType, ChatInputCommandInteraction, Client, Events, GuildMemberFlags, Locale, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Message, OmitPartialGroupDMChannel } from 'discord.js';
import { createLifecycle } from '../src/app';
import { createCommandRegistry, createRuntimeRegistry } from '../src/commands/registry';
import type { AppContext, PrefixCommand, SlashCommand } from '../src/commands/types';
import { loadConfig } from '../src/config';
import { dispatchInteraction, dispatchMessage, parsePrefixCommand, registerEvents, replyToInteractionError } from '../src/events';
import type { ErrorReplyTarget } from '../src/events';

const userId = '111111111111111111';
const channelId = '222222222222222222';
const guildId = '333333333333333333';
const messageId = '444444444444444444';
const apiUser = { id: userId, username: 'visitor', global_name: null, discriminator: '0000', avatar: null, bot: false };

class OfflineInteraction extends ChatInputCommandInteraction {
    constructor(client: Client<true>, name: string, guild = true) {
        super(client, {
            id: '555555555555555555', application_id: '666666666666666666', type: 2,
            token: 'offline-interaction', version: 1, locale: Locale.EnglishUS,
            user: apiUser, channel_id: channelId, channel: { id: channelId, type: 0, name: 'offline' },
            ...(guild ? {
                guild_id: guildId,
                member: { user: apiUser, roles: [], joined_at: '2026-01-01T00:00:00.000Z', deaf: false, mute: false, flags: GuildMemberFlags.CompletedOnboarding, permissions: '0' },
            } : {}),
            data: { id: '777777777777777777', name, type: 1 },
            app_permissions: '0', entitlements: [], authorizing_integration_owners: {}, attachment_size_limit: 10485760,
        });
    }
}

function command(name = 'probe', ownerOnly = false, execute: PrefixCommand['execute'] = async () => {}): PrefixCommand {
    return { name, aliases: ['alias'], usage: name, description: 'Dispatch probe', category: 'test', ownerOnly, execute };
}

function slash(execute: SlashCommand['execute'], ownerOnly = false): SlashCommand {
    return {
        name: 'probe', usage: 'probe', description: 'Dispatch probe', category: 'test', ownerOnly,
        data: new SlashCommandBuilder().setName('probe').setDescription('Dispatch probe'), execute,
    };
}

function fixture(prefix: readonly PrefixCommand[] = [], commands: readonly SlashCommand[] = []) {
    const client = new Client<true>({ intents: [] });
    client.rest.request = async () => { throw new Error('Unexpected REST request in offline fixture'); };
    const lifecycle = createLifecycle();
    const context: AppContext = { client, lifecycle, config: loadConfig({}), registry: createCommandRegistry(prefix, commands) };
    return { client, lifecycle, context };
}

function supportedMessage(message: Message): message is OmitPartialGroupDMChannel<Message> {
    return message.channel.type !== ChannelType.GroupDM;
}

async function messageFixture(client: Client<true>, content: string, options: { guild?: boolean; bot?: boolean; userId?: string; channelId?: string } = {}) {
    const id = options.channelId ?? channelId;
    client.rest.get = async route => {
        if (route === `/channels/${id}`) return { id, type: 1, recipients: [apiUser] };
        return {
            id: messageId, channel_id: id, ...(options.guild === false ? {} : { guild_id: guildId }),
            author: { ...apiUser, id: options.userId ?? userId, bot: options.bot ?? false },
            content, type: 0, timestamp: '2026-01-01T00:00:00.000Z', edited_timestamp: null,
            tts: false, mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: false,
        };
    };
    const channel = await client.channels.fetch(id);
    assert.ok(channel?.isDMBased());
    channel.messages.cache.delete(messageId);
    const message = await channel.messages.fetch({ message: messageId, force: true });
    assert.ok(supportedMessage(message));
    const replies: Parameters<typeof message.reply>[0][] = [];
    message.reply = async options => { replies.push(options); return message; };
    return { message, replies };
}

function responseTarget(deferred: boolean, replied: boolean) {
    const writes: { method: string; content: string; flags?: MessageFlags.Ephemeral }[] = [];
    const target: ErrorReplyTarget = {
        deferred, replied,
        async reply(options) { writes.push({ method: 'reply', ...options }); },
        async editReply(options) { writes.push({ method: 'editReply', ...options }); },
        async followUp(options) { writes.push({ method: 'followUp', ...options }); },
    };
    return { target, writes };
}

function boundary(context: AppContext, reports: string[]) {
    return registerEvents(context, {
        giveaways: null, accepting: () => true,
        logger: { info() {}, warn() {}, error() {} },
        reportError(operation) { reports.push(operation); },
        async ready() {}, readyFailed(error) { throw error; },
    });
}

test('prefix parsing handles configured whitespace, mixed case and arguments without broad prefix matches', () => {
    assert.deepEqual(parsePrefixCommand('SM\tAlIaS  one\nTwo\tthree', 'sm '), { name: 'alias', args: ['one', 'Two', 'three'] });
    assert.deepEqual(parsePrefixCommand('!PiNg\tOne', '!'), { name: 'ping', args: ['One'] });
    for (const content of ['smhelp', 'sm', 'sm   ', 'other help']) assert.equal(parsePrefixCommand(content, 'sm '), null);
});

test('real messages dispatch aliases and await command rejection rather than dropping the promise', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failure = new Error('private-command-secret');
    const f = fixture([command('probe', false, async (_context, _message, args) => {
        assert.deepEqual(args, ['one', 'Two']); entered.resolve(); await release.promise; throw failure;
    })]);
    try {
        const m = await messageFixture(f.client, 'SM\tAlIaS  one\nTwo');
        let settled = false;
        const dispatch = dispatchMessage(f.context, m.message);
        const rejected = assert.rejects(dispatch, error => { assert.equal(error, failure); return true; }).then(() => { settled = true; });
        await entered.promise;
        assert.equal(settled, false);
        release.resolve();
        await rejected;
    } finally { release.resolve(); await f.client.destroy(); }
});

test('prefix dispatch ignores bots, DMs and blocked channels, and denies blocked users', async () => {
    let executions = 0;
    const f = fixture([command('probe', false, async () => { executions++; })]);
    try {
        for (const options of [{ bot: true }, { guild: false }, { channelId: f.context.config.blockedChannelIds[0]! }]) {
            const m = await messageFixture(f.client, 'sm probe', options);
            await dispatchMessage(f.context, m.message);
            assert.deepEqual(m.replies, []);
        }
        const blocked = await messageFixture(f.client, 'sm probe', { userId: f.context.config.blockedUserIds[0]! });
        await dispatchMessage(f.context, blocked.message);
        assert.deepEqual(blocked.replies, [{ content: "You're banned from using this bot.", allowedMentions: { parse: [], repliedUser: false } }]);
        assert.equal(executions, 0);
    } finally { await f.client.destroy(); }
});

test('ordinary users cannot execute owner-only commands, including run, restart and shutdown', async () => {
    const registry = createRuntimeRegistry(null);
    const f = fixture();
    const context: AppContext = { ...f.context, registry };
    try {
        for (const name of ['run', 'restart', 'shutdown']) {
            assert.equal(registry.prefixLookup.get(name)?.ownerOnly, true);
            const m = await messageFixture(f.client, `sm ${name} dangerous-input`);
            await dispatchMessage(context, m.message);
            assert.deepEqual(m.replies, [{ content: 'Only the bot owner can use this command.', allowedMentions: { parse: [], repliedUser: false } }]);
        }
        let executions = 0;
        const protectedContext: AppContext = { ...context, registry: createCommandRegistry([command('private', true, async () => { executions++; })], []) };
        const ordinary = await messageFixture(f.client, 'sm private');
        await dispatchMessage(protectedContext, ordinary.message);
        assert.equal(executions, 0);
        const owner = await messageFixture(f.client, 'sm private', { userId: context.config.ownerID });
        await dispatchMessage(protectedContext, owner.message);
        assert.equal(executions, 1);
    } finally { await f.client.destroy(); }
});

test('error replies choose initial reply, deferred edit, or follow-up without mentioning users', async () => {
    for (const [deferred, replied, method] of [[false, false, 'reply'], [true, false, 'editReply'], [false, true, 'followUp'], [true, true, 'followUp']] as const) {
        const f = responseTarget(deferred, replied);
        await replyToInteractionError(f.target);
        assert.deepEqual(f.writes, [{
            method, content: 'Something went wrong. Please try again later.',
            allowedMentions: { parse: [], repliedUser: false },
            ...(method === 'editReply' ? {} : { flags: MessageFlags.Ephemeral }),
        }]);
    }
});

test('genuine slash interactions await rejected commands and enforce guild, blocked and owner boundaries', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failure = new Error('private slash failure');
    let executions = 0;
    const f = fixture([], [slash(async () => { executions++; entered.resolve(); await release.promise; throw failure; })]);
    try {
        const interaction = new OfflineInteraction(f.client, 'probe');
        const rejected = assert.rejects(dispatchInteraction(f.context, interaction, null), error => { assert.equal(error, failure); return true; });
        await entered.promise;
        release.resolve();
        await rejected;
        for (const kind of ['dm', 'blocked-user', 'blocked-channel', 'owner-only', 'missing']) {
            const target = new OfflineInteraction(f.client, kind === 'missing' ? 'missing' : 'probe', kind !== 'dm');
            const replies: unknown[] = [];
            f.client.rest.post = async (_route, options) => { replies.push(options?.body); return {}; };
            const context: AppContext = {
                ...f.context,
                config: { ...f.context.config, blockedUserIds: kind === 'blocked-user' ? [userId] : [], blockedChannelIds: kind === 'blocked-channel' ? [channelId] : [] },
                registry: kind === 'owner-only' ? createCommandRegistry([], [slash(async () => { executions++; }, true)]) : f.context.registry,
            };
            await dispatchInteraction(context, target, null);
            assert.equal(replies.length, 1);
            assert.match(JSON.stringify(replies[0]), /"flags":64/);
        }
        assert.equal(executions, 1);
    } finally { release.resolve(); await f.client.destroy(); }
});

test('event boundary contains command and response-write failures without exposing private error text', async () => {
    const secret = 'private-token-and-database-password';
    const f = fixture([command('probe', false, async () => { throw new Error(secret); })], [slash(async () => { throw new Error(secret); })]);
    const reports: string[] = [];
    const remove = boundary(f.context, reports);
    try {
        const m = await messageFixture(f.client, 'sm probe');
        f.client.emit(Events.MessageCreate, m.message);
        await f.lifecycle.drain();
        assert.deepEqual(m.replies, [{ content: 'Something went wrong. Please try again later.', allowedMentions: { parse: [], repliedUser: false } }]);
        const interaction = new OfflineInteraction(f.client, 'probe');
        const writes: unknown[] = [];
        f.client.rest.post = async (_route, options) => { writes.push(options?.body); throw new Error('response transport failure'); };
        f.client.emit(Events.InteractionCreate, interaction);
        await f.lifecycle.drain();
        assert.match(JSON.stringify(writes[0]), /Something went wrong\. Please try again later\./);
        assert.equal(JSON.stringify(writes).includes(secret), false);
        assert.deepEqual(reports, ['Prefix command', 'Interaction', Events.InteractionCreate]);
        m.message.reply = async () => { throw new Error('message transport failure'); };
        f.client.emit(Events.MessageCreate, m.message);
        await f.lifecycle.drain();
        assert.deepEqual(reports.slice(-2), ['Prefix command', Events.MessageCreate]);
    } finally {
        remove();
        await f.lifecycle.cleanup();
        await f.client.destroy();
    }
    assert.equal(f.client.listenerCount(Events.MessageCreate), 0);
    assert.equal(f.client.listenerCount(Events.InteractionCreate), 0);
});
