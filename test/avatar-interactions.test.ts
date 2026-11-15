import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import {
    ButtonInteraction, ChannelType, Client, ClientUser, ComponentType, Events,
    GuildMemberFlags, InteractionType, Locale, MessageType,
} from 'discord.js';
import type { AppContext } from '../src/commands/types';
import { prefixCommands } from '../src/commands/utility';
import { createLifecycle } from '../src/app';
import { loadConfig } from '../src/config';

const userId = '111111111111111111';
const guildId = '222222222222222222';
const channelId = '333333333333333333';
const messageId = '444444444444444444';
const responseId = '555555555555555555';
const applicationId = '666666666666666666';
const firstClick = '777777777777777777';
const secondClick = '888888888888888888';
const apiUser = { id: userId, username: 'visitor', global_name: null, discriminator: '0000', avatar: 'user-avatar', bot: false };
const apiBot = { ...apiUser, id: applicationId, username: 'bot', bot: true };
const apiMember = { user: apiUser, roles: [], joined_at: '2026-01-01T00:00:00.000Z', deaf: false, mute: false, flags: GuildMemberFlags.CompletedOnboarding, avatar: 'server-avatar', permissions: '0' };

class OfflineUser extends ClientUser {
    constructor(client: Client<true>) { super(client, apiBot); }
}

function rawMessage(id: string) {
    return {
        id, channel_id: channelId, guild_id: guildId, author: id === responseId ? apiBot : apiUser, content: '', type: MessageType.Default,
        timestamp: '2026-01-01T00:00:00.000Z', edited_timestamp: null, tts: false, mention_everyone: false,
        mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: false, components: [],
    };
}

function isButtonInteraction(value: unknown): value is ButtonInteraction {
    return value instanceof ButtonInteraction;
}

function avatarInteraction(client: Client<true>, id: string, control: string, actor = userId): ButtonInteraction {
    const interaction: unknown = Reflect.construct(ButtonInteraction, [client, {
        id, application_id: applicationId, type: InteractionType.MessageComponent,
        token: id, version: 1, locale: Locale.EnglishUS, guild_id: guildId,
        channel_id: channelId, channel: { id: channelId, type: ChannelType.GuildText, name: 'offline' },
        member: { ...apiMember, user: { ...apiUser, id: actor } },
        message: rawMessage(responseId), data: { component_type: ComponentType.Button, custom_id: control },
        app_permissions: '0', entitlements: [], authorizing_integration_owners: {}, attachment_size_limit: 10485760,
    }]);
    assert.ok(isButtonInteraction(interaction));
    return interaction;
}

function imageOf(body: unknown): unknown {
    assert.ok(typeof body === 'object' && body !== null && 'embeds' in body);
    assert.ok(Array.isArray(body.embeds));
    const embed: unknown = body.embeds[0];
    assert.ok(typeof embed === 'object' && embed !== null && 'image' in embed);
    assert.ok(typeof embed.image === 'object' && embed.image !== null && 'url' in embed.image);
    return embed.image.url;
}

async function fixture() {
    const client = new Client<true>({ intents: [] });
    client.user = new OfflineUser(client);
    client.rest.request = async () => { throw new Error('Unexpected Discord REST request'); };
    client.rest.get = async route => {
        if (route === `/guilds/${guildId}`) return { id: guildId, name: 'offline', owner_id: userId, roles: [], emojis: [], stickers: [], features: [] };
        if (route === `/guilds/${guildId}/members/${userId}`) return apiMember;
        if (route === `/channels/${channelId}`) return { id: channelId, guild_id: guildId, type: ChannelType.GuildText, name: 'offline' };
        if (route === `/channels/${channelId}/messages/${messageId}`) return rawMessage(messageId);
        if (route === `/channels/${channelId}/messages/${responseId}`) return rawMessage(responseId);
        throw new Error(`Unexpected GET ${route}`);
    };
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    const channel = await guild.channels.fetch(channelId);
    assert.ok(channel?.type === ChannelType.GuildText);
    const message = await channel.messages.fetch(messageId);
    const response = await channel.messages.fetch(responseId);
    message.reply = async () => response;
    const lifecycle = createLifecycle();
    const ready = Promise.withResolvers<void>();
    const context: AppContext = {
        client, config: loadConfig({}), registry: { prefix: prefixCommands, slash: [], prefixLookup: new Map(), slashLookup: new Map() },
        lifecycle: {
            track: promise => lifecycle.track(promise),
            registerCleanup(cleanup) {
                const unregister = lifecycle.registerCleanup(cleanup);
                ready.resolve();
                return unregister;
            },
        },
    };
    const acknowledged: string[] = [];
    const writes: unknown[] = [];
    const firstEdit = Promise.withResolvers<void>();
    const releaseEdit = Promise.withResolvers<void>();
    let acknowledgementFailure: Error | undefined;
    let editFailure: Error | undefined;
    client.rest.post = async route => {
        if (!route.startsWith('/interactions/')) throw new Error(`Unexpected POST ${route}`);
        const id = route.split('/')[2];
        assert.ok(id);
        acknowledged.push(id);
        if (id === secondClick && acknowledgementFailure) throw acknowledgementFailure;
        return undefined;
    };
    client.rest.patch = async (route, options) => {
        const body: unknown = options?.body;
        writes.push(structuredClone(body));
        if (route.startsWith('/webhooks/')) {
            if (writes.length === 1) {
                firstEdit.resolve();
                await releaseEdit.promise;
            }
            if (editFailure) throw editFailure;
            return rawMessage(responseId);
        }
        assert.equal(route, `/channels/${channelId}/messages/${responseId}`);
        return rawMessage(responseId);
    };
    const avatar = prefixCommands.find(command => command.name === 'avatar');
    assert.ok(avatar);
    const running = lifecycle.track(avatar.execute(context, message, []));
    void running.catch(() => {});
    await ready.promise;
    return {
        client, lifecycle, running, acknowledged, writes, firstEdit, releaseEdit,
        userAvatar: member.user.displayAvatarURL({ size: 4096 }), serverAvatar: member.displayAvatarURL({ size: 4096 }),
        click(id: string, control: string, actor = userId) { client.emit(Events.InteractionCreate, avatarInteraction(client, id, control, actor)); },
        failAcknowledgement(error: Error) { acknowledgementFailure = error; },
        failEdit(error: Error) { editFailure = error; },
        async close() {
            releaseEdit.resolve();
            await lifecycle.cleanup();
            await running.catch(() => {});
            await client.destroy();
        },
    };
}

test('avatar acknowledges clicks during a pending edit and drains them before disabling controls', { timeout: 10_000 }, async t => {
    const f = await fixture();
    t.after(() => f.close());
    f.click(firstClick, 'server');
    await f.firstEdit.promise;
    f.click(secondClick, 'user');
    await setImmediate();
    assert.deepEqual(f.acknowledged, [firstClick, secondClick]);
    assert.equal(f.writes.length, 1);
    await f.lifecycle.cleanup();
    f.releaseEdit.resolve();
    await f.running;
    assert.deepEqual(f.writes.map(imageOf), [f.serverAvatar, f.userAvatar, f.userAvatar]);
    const final: unknown = f.writes[2];
    assert.ok(typeof final === 'object' && final !== null && 'components' in final);
    assert.ok(Array.isArray(final.components));
    const row: unknown = final.components[0];
    assert.ok(typeof row === 'object' && row !== null && 'components' in row && Array.isArray(row.components));
    const controls = row.components.map((button: unknown) => {
        assert.ok(typeof button === 'object' && button !== null && 'custom_id' in button && 'disabled' in button);
        return { id: button.custom_id, disabled: button.disabled };
    });
    assert.deepEqual(controls, [{ id: 'user', disabled: true }, { id: 'server', disabled: true }]);
    f.click('999999999999999999', 'server');
    await setImmediate();
    assert.deepEqual(f.acknowledged, [firstClick, secondClick]);
});

test('avatar ignores other users and unrelated controls without changing the displayed avatar', { timeout: 10_000 }, async t => {
    const f = await fixture();
    t.after(() => f.close());
    f.click(firstClick, 'server', '999999999999999999');
    f.click(secondClick, 'unrelated');
    await setImmediate();
    assert.deepEqual(f.acknowledged, []);
    assert.deepEqual(f.writes, []);
    await f.lifecycle.cleanup();
    await f.running;
    assert.equal(imageOf(f.writes[0]), f.userAvatar);
});

test('avatar surfaces a failed acknowledgement while an earlier edit is pending and releases the collector', { timeout: 10_000 }, async t => {
    const f = await fixture();
    t.after(() => f.close());
    const failure = new Error('acknowledgement failed');
    f.failAcknowledgement(failure);
    const rejected = assert.rejects(f.running, error => error === failure);
    f.click(firstClick, 'server');
    await f.firstEdit.promise;
    f.click(secondClick, 'user');
    await setImmediate();
    assert.deepEqual(f.acknowledged, [firstClick, secondClick]);
    f.releaseEdit.resolve();
    await rejected;
    f.click('999999999999999999', 'server');
    await setImmediate();
    assert.deepEqual(f.acknowledged, [firstClick, secondClick]);
});

test('avatar edit failure rejects the command without leaving an active collector', { timeout: 10_000 }, async t => {
    const f = await fixture();
    t.after(() => f.close());
    const failure = new Error('message edit failed');
    f.failEdit(failure);
    const rejected = assert.rejects(f.running, error => error === failure);
    f.click(firstClick, 'server');
    await f.firstEdit.promise;
    f.releaseEdit.resolve();
    await rejected;
    f.click(secondClick, 'user');
    await setImmediate();
    assert.deepEqual(f.acknowledged, [firstClick]);
});
