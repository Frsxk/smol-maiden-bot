import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, Client, ClientUser, MessagePayload, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import type { MessageReplyOptions } from 'discord.js';
import { managementInput, prefixCommands } from '../src/commands/channel-manager';
import type { AppContext } from '../src/commands/types';
import { loadConfig } from '../src/config';

const GUILD = '111111111111111111', CHANNEL = '222222222222222222', PARENT = '333333333333333333';
const ACTOR = '444444444444444444', BOT = '555555555555555555', OWNER = '666666666666666666';
const COMMAND = '777777777777777777', TARGET = '888888888888888888', ROLE = '999999999999999999';
const timestamp = '2026-01-01T00:00:00.000Z';
const user = (id: string) => ({ id, username: id, discriminator: '0', avatar: null, bot: id === BOT });

class OfflineUser extends ClientUser {
    constructor(client: Client<true>) { super(client, user(BOT)); }
}

async function fixture(type: ChannelType.GuildText | ChannelType.GuildAnnouncement | ChannelType.PublicThread | ChannelType.AnnouncementThread) {
    const client = new Client<true>({ intents: [] });
    client.user = new OfflineUser(client);
    const calls: string[] = [];
    const state = { actorPermissions: PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.Administrator,
        botPermissions: PermissionFlagsBits.PinMessages, actorPresent: true, pinned: true };
    const apiMessage = (id: string) => ({
        id, channel_id: CHANNEL, guild_id: GUILD, author: user(ACTOR), content: 'offline', type: 0,
        timestamp, edited_timestamp: null, tts: false, mention_everyone: false,
        mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: id === TARGET && state.pinned,
    });
    client.rest.request = async () => { throw new Error('Unexpected offline REST request'); };
    client.rest.get = async route => {
        calls.push(`GET ${route}`);
        if (route === `/guilds/${GUILD}`) return {
            id: GUILD, name: 'Offline', owner_id: OWNER,
            roles: [
                { id: GUILD, name: '@everyone', permissions: String(PermissionFlagsBits.ViewChannel), position: 0 },
                { id: ROLE, name: 'Manager', permissions: String(state.actorPermissions), position: 1 },
            ],
        };
        if (route === `/guilds/${GUILD}/members/${ACTOR}`) {
            if (!state.actorPresent) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
            return { user: user(ACTOR), roles: state.actorPermissions ? [ROLE] : [], joined_at: timestamp };
        }
        if (route === `/guilds/${GUILD}/members/${BOT}`) return { user: user(BOT), roles: [], joined_at: timestamp };
        if (route === `/channels/${PARENT}` || route === `/channels/${CHANNEL}`) return {
            id: route === `/channels/${PARENT}` ? PARENT : CHANNEL, guild_id: GUILD, name: 'offline',
            type: route === `/channels/${PARENT}` ? ChannelType.GuildText : type,
            parent_id: type === ChannelType.PublicThread || type === ChannelType.AnnouncementThread ? PARENT : null,
            owner_id: ACTOR, permission_overwrites: [],
            thread_metadata: { archived: false, auto_archive_duration: 1440, archive_timestamp: timestamp, locked: false },
        };
        if (route === `/channels/${CHANNEL}/messages/pins`) return {
            items: [{ pinned_at: timestamp, message: apiMessage(TARGET) }], has_more: true,
        };
        if (route === `/channels/${CHANNEL}/messages/${COMMAND}`) return apiMessage(COMMAND);
        if (route === `/channels/${CHANNEL}/messages/${TARGET}`) return apiMessage(TARGET);
        throw new Error(`Unexpected offline GET: ${route}`);
    };
    client.rest.put = async route => { calls.push(`PUT ${route}`); return undefined; };
    client.rest.delete = async route => { calls.push(`DELETE ${route}`); return undefined; };
    const guild = await client.guilds.fetch(GUILD);
    await guild.members.fetch(ACTOR);
    const bot = await guild.members.fetch(BOT);
    bot.permissionsIn = () => new PermissionsBitField(state.botPermissions);
    guild.members.fetchMe = async () => bot;
    await guild.channels.fetch(PARENT);
    const channel = await guild.channels.fetch(CHANNEL);
    assert.ok(channel?.isTextBased());
    const message = await channel.messages.fetch(COMMAND);
    assert.ok(message.inGuild());
    const replies: MessageReplyOptions[] = [];
    message.reply = async options => {
        assert.ok(typeof options === 'object' && !(options instanceof MessagePayload));
        replies.push(options); return message;
    };
    const context: AppContext = {
        client, config: { ...loadConfig({}), ownerID: OWNER },
        registry: { prefix: prefixCommands, slash: [], prefixLookup: new Map(), slashLookup: new Map() },
        lifecycle: { track: promise => promise, registerCleanup: () => () => {} },
    };
    calls.length = 0;
    return { client, channel, message, context, calls, state, replies,
        async execute(name: string, args: readonly string[] = []) {
            const command = prefixCommands.find(entry => entry.name === name); assert.ok(command);
            await command.execute(context, message, args);
        },
    };
}

for (const type of [ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.AnnouncementThread] as const) {
    test(`pin utilities execute against real message managers in ${ChannelType[type]}`, async () => {
        const f = await fixture(type);
        try {
            await f.execute('pin', [TARGET]);
            await f.execute('unpin', [TARGET]);
            assert.ok(f.calls.includes(`PUT /channels/${CHANNEL}/messages/pins/${TARGET}`));
            assert.ok(f.calls.includes(`DELETE /channels/${CHANNEL}/messages/pins/${TARGET}`));
            assert.equal(f.calls.filter(call => call.includes('/reactions/')).length, 2);
            await f.execute('pinscount');
            const embed = f.replies.at(-1)?.embeds?.[0]; assert.ok(embed);
            const data = 'toJSON' in embed ? embed.toJSON() : embed;
            assert.match(data.description ?? '', /Fetched 1 pinned messages/);
            assert.match(data.description ?? '', /first page only/);
            assert.equal(f.calls.filter(call => call === `GET /channels/${CHANNEL}/messages/pins`).length, 1);
        } finally { await f.client.destroy(); }
    });
}

test('thread utilities preserve caller and bot permissions, channel validation and unpinned refusal', async () => {
    const f = await fixture(ChannelType.PublicThread);
    try {
        f.state.botPermissions = 0n;
        await f.execute('pin', [TARGET]);
        assert.match(f.replies.at(-1)?.content ?? '', /need Pin Messages/);
        f.state.botPermissions = PermissionFlagsBits.PinMessages;
        await f.execute('pin', [`https://discord.com/channels/${GUILD}/${PARENT}/${TARGET}`]);
        assert.match(f.replies.at(-1)?.content ?? '', /Reply to a message in this channel/);
        f.state.pinned = false;
        await f.execute('unpin', [TARGET]);
        assert.match(f.replies.at(-1)?.content ?? '', /isn't pinned/);
        f.state.actorPermissions = 0n;
        await f.message.guild.members.fetch({ user: ACTOR, force: true });
        await f.execute('pin', [TARGET]);
        assert.match(f.replies.at(-1)?.content ?? '', /need Manage Messages/);
        assert.equal(f.calls.some(call => call.startsWith('PUT ') || call.startsWith('DELETE ')), false);
    } finally { await f.client.destroy(); }
});

test('ownership commands still reject threads before registry access', async () => {
    const f = await fixture(ChannelType.PublicThread);
    try {
        for (const command of ['claim', 'lock', 'unlock', 'whitelist', 'blacklist']) await f.execute(command);
        assert.match(f.replies[0]?.content ?? '', /Threads cannot be claimed/);
        for (const reply of f.replies.slice(1)) assert.match(reply.content ?? '', /Only regular text channels/);
        assert.deepEqual(f.calls, []);
    } finally { await f.client.destroy(); }
});

test('management authorization refreshes actor and channel instead of using the message member snapshot', async () => {
    const f = await fixture(ChannelType.GuildText);
    try {
        assert.equal(f.channel.type, ChannelType.GuildText);
        if (f.channel.type !== ChannelType.GuildText) throw new Error('Expected text channel');
        const input = managementInput(f.context, f.message, f.channel);
        assert.equal((await input.authorization())?.administrator, true);
        f.state.actorPermissions = 0n;
        assert.deepEqual(await input.authorization(), { administrator: false, manageChannels: false });
        assert.equal(f.calls.filter(call => call === `GET /guilds/${GUILD}/members/${ACTOR}`).length, 2);
        assert.equal(f.calls.filter(call => call === `GET /channels/${CHANNEL}`).length, 2);
        f.state.actorPresent = false;
        await assert.rejects(input.authorization(), /Unknown Member/);
    } finally { await f.client.destroy(); }
});
