import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import type { Message, TextChannel } from 'discord.js';
import type { AppContext, PrefixCommand, SlashCommand } from '../types';
import { ownershipStore } from '../../database/ownership-store';
import { applyChannelState, withChannelLock } from '../../features/channel-manager/channel-permissions';
import { createManagement } from '../../features/channel-manager/management';
import type { ManagementDependencies, ManagementInput } from '../../features/channel-manager/management';

export interface PinTransport {
    isPinned(id: string): Promise<boolean>;
    write(action: 'pin' | 'unpin', id: string): Promise<void>;
    react(): Promise<void>;
}

export async function updatePin(action: 'pin' | 'unpin', id: string, transport: PinTransport): Promise<boolean> {
    if (action === 'unpin' && !await transport.isPinned(id)) return false;
    await transport.write(action, id);
    await transport.react();
    return true;
}

export function managementInput(context: AppContext, message: Message<true>, channel: TextChannel): ManagementInput {
    return {
        author: message.author, channel, guildId: message.guild.id, guildOwnerId: message.guild.ownerId,
        botId: context.client.user?.id ?? context.config.botClientID, config: context.config,
        authorization: async () => {
            const member = await message.guild.members.fetch({ user: message.author.id, force: true });
            const fresh = await message.guild.channels.fetch(channel.id, { force: true });
            if (fresh?.type !== ChannelType.GuildText) return null;
            return {
                administrator: member.permissions.has(PermissionFlagsBits.Administrator),
                manageChannels: member.permissionsIn(fresh).has(PermissionFlagsBits.ManageChannels),
            };
        },
        botPermissions: async () => (await message.guild.members.fetchMe()).permissionsIn(channel),
        fetchChannel: async id => {
            const fresh = await message.guild.channels.fetch(id, { force: true });
            return fresh && 'permissionOverwrites' in fresh ? fresh : null;
        },
        fetchMember: id => message.guild.members.fetch(id),
        cachedMembers: () => message.guild.members.cache.values(),
        searchMembers: async query => (await message.guild.members.fetch({ query, limit: 1000 })).values(),
        reply: async payload => { await message.reply(payload); },
    };
}

export function parseMessageId(value: string | undefined, guildId: string, channelId: string): string | null {
    if (!value) return null;
    if (/^\d{17,20}$/.test(value)) return value;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || !['discord.com', 'www.discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com'].includes(url.hostname)) return null;
        const match = /^\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/.exec(url.pathname);
        return match?.[1] === guildId && match[2] === channelId ? match[3] ?? null : null;
    } catch { return null; }
}

const descriptions = {
    claim: 'Claim this text channel. Requires Manage Channels; one channel per user.',
    lock: 'Hide your channel from ordinary members. Owner, bot, and whitelisted members keep access.',
    unlock: "Restore the channel's previous view permissions, keeping blacklist restrictions.",
    whitelist: 'Let a member see your channel while it is locked.',
    blacklist: 'Deny a member access until removed from the blacklist. Administrators bypass these restrictions.',
    pin: "Pin a message in this channel.\nTo copy a message ID, enable [Developer Mode](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID-). You'll find it under User Settings -> Advanced (or Behavior on mobile).",
    unpin: "Unpin a message in this channel.\nTo copy a message ID, enable [Developer Mode](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID-). You'll find it under User Settings -> Advanced (or Behavior on mobile).",
    pinscount: 'Count the pinned messages in a channel.',
    'create-channel': 'Create a new channel in the setup category. Bot owner only.',
    upgrade: 'Move your channel to the next category!',
};
const definitions: readonly { name: keyof typeof descriptions; aliases: readonly string[]; usage: string }[] = [
    { name: 'claim', aliases: [], usage: 'sm claim' }, { name: 'lock', aliases: ['l'], usage: 'sm lock' },
    { name: 'unlock', aliases: ['ul'], usage: 'sm unlock' },
    { name: 'whitelist', aliases: ['wl', 'invite'], usage: 'sm whitelist add/remove [user]' },
    { name: 'blacklist', aliases: ['bl', 'uninvite'], usage: 'sm blacklist add/remove [user]' },
    { name: 'pin', aliases: ['p'], usage: 'sm pin <message ID>' }, { name: 'unpin', aliases: ['unp'], usage: 'sm unpin <message ID>' },
    { name: 'pinscount', aliases: ['pc'], usage: 'sm pinscount' },
    { name: 'create-channel', aliases: ['createch', 'newch'], usage: 'sm create-channel <channel-name>' },
    { name: 'upgrade', aliases: ['up', 'upg'], usage: 'sm upgrade <#channel>' },
];

export function createChannelManagerCommands(dependencies: ManagementDependencies = { store: ownershipStore, apply: applyChannelState, lock: withChannelLock }): PrefixCommand[] {
    const manage = createManagement(dependencies);
    return definitions.map(definition => ({
        ...definition, category: 'Channel Manager', description: descriptions[definition.name], ownerOnly: definition.name === 'create-channel',
        async execute(context, message, args): Promise<void> {
            const reply = async (content: string): Promise<void> => {
                await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
            };
            const success = async (title: string, description: string): Promise<void> => {
                await message.reply({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(context.config.embedColor)
                    .setFooter({ text: context.config.embedFooterText1 }).setTimestamp()], allowedMentions: { parse: [], repliedUser: false } });
            };
            const name = definition.name;
            if (!message.member) { await reply("I couldn't verify your server membership."); return; }
            const channel = message.channel;
            if (name === 'claim' || name === 'lock' || name === 'unlock' || name === 'whitelist' || name === 'blacklist') {
                if (name === 'claim' && channel.isThread()) { await reply('Threads cannot be claimed. Use `sm claim` in a regular text channel.'); return; }
                if (channel.type !== ChannelType.GuildText) { await reply('Only regular text channels can be managed.'); return; }
                await manage(name, managementInput(context, message, channel), args); return;
            }
            if ((name === 'create-channel' || name === 'upgrade') && channel.type !== ChannelType.GuildText) {
                await reply('Only regular text channels can be managed.'); return;
            }
            let response: { title: string; description: string } | undefined;
            let failure: string | undefined;
            try {
                if (name === 'pin' || name === 'unpin') {
                    const permissions = message.member.permissionsIn(channel);
                    if (message.author.id !== context.config.ownerID && !permissions.has(PermissionFlagsBits.ManageMessages) && !permissions.has(PermissionFlagsBits.Administrator)) {
                        failure = `You need Manage Messages to ${name} messages here.`;
                    } else {
                        const bot = await message.guild.members.fetchMe();
                        if (!bot.permissionsIn(channel).has(PermissionFlagsBits.PinMessages)) failure = 'I need Pin Messages in this channel to manage pins.';
                        else {
                            const reference = message.reference;
                            const value = args[0] ?? (reference?.channelId === channel.id && (!reference.guildId || reference.guildId === message.guild.id) ? reference.messageId : undefined);
                            const id = parseMessageId(value, message.guild.id, channel.id);
                            if (!id) failure = `Reply to a message in this channel, or use: \`sm ${name} <message ID>\``;
                            else {
                                const updated = await updatePin(name, id, {
                                    isPinned: async target => (await channel.messages.fetch(target)).pinned,
                                    write: async (action, target) => {
                                        if (action === 'pin') await channel.messages.pin(target); else await channel.messages.unpin(target);
                                    },
                                    react: async () => { await message.react('✅'); },
                                });
                                if (updated) return;
                                failure = "That message isn't pinned.";
                            }
                        }
                    }
                } else if (name === 'pinscount') {
                    const requested = message.mentions.channels.first()?.id ?? args[0];
                    if (requested && message.author.id !== context.config.ownerID) failure = "Only the bot owner can check another channel's pins. Run this command without arguments to check the current channel.";
                    else {
                        const target = requested ? await context.client.channels.fetch(requested) : channel;
                        if (!target?.isTextBased() || !('messages' in target)) failure = 'That channel does not support pinned messages.';
                        else {
                            const pins = await target.messages.fetchPins();
                            response = { title: 'Success! :white_check_mark:', description: `Fetched ${pins.items.length} pinned messages from <#${target.id}>.\nThis command counts the first page only.` };
                        }
                    }
                } else if (name === 'create-channel') {
                    if (message.author.id !== context.config.ownerID) failure = 'Only the bot owner can create channels.';
                    else if (!args[0]) failure = 'Please provide a channel name!';
                    else {
                        const categoryId = context.config.guilds[message.guild.id]?.createChannelCategoryId;
                        const category = categoryId ? await message.guild.channels.fetch(categoryId) : null;
                        if (category?.type !== ChannelType.GuildCategory) failure = 'Channel creation is not configured for this server.';
                        else {
                            const created = await message.guild.channels.create({ name: args.join('-'), type: ChannelType.GuildText, parent: category.id });
                            response = { title: '📜 Channel Create', description: `Created <#${created.id}> in **${category.name}**.` };
                        }
                    }
                } else if (name === 'upgrade') {
                    const id = message.mentions.channels.first()?.id ?? args[0]?.replace(/^<#(\d{17,20})>$/, '$1');
                    if (!id) failure = 'Mention the channel you want to move. Usage: sm upgrade <#channel>';
                    else if (!dependencies.store.isReady()) failure = 'The channel registry is unavailable right now. Try again in a moment.';
                    else {
                        await dependencies.lock(id, async () => {
                            const target = await message.guild.channels.fetch(id, { force: true });
                            if (target?.type !== ChannelType.GuildText) { failure = 'Only regular text channels can be upgraded.'; return; }
                            const doc = await dependencies.store.findByChannel(id);
                            const canManage = message.member?.permissionsIn(target).has(PermissionFlagsBits.ManageChannels) ?? false;
                            if (doc ? doc.userId !== message.author.id && !canManage : !canManage) { failure = 'Only the channel owner or a member with Manage Channels can upgrade this channel.'; return; }
                            const progression = context.config.guilds[message.guild.id]?.categoryProgression.find(step => step.fromCategoryId === target.parentId);
                            if (!progression) { failure = "That channel isn't in a category this command can upgrade."; return; }
                            if (!message.member?.roles.cache.has(progression.requiredRoleId)) { failure = `You need the role <@&${progression.requiredRoleId}> to move your channel to the next category.`; return; }
                            const category = await message.guild.channels.fetch(progression.toCategoryId);
                            if (category?.type !== ChannelType.GuildCategory) { failure = 'The next category is not configured correctly.'; return; }
                            await target.setParent(category, { lockPermissions: false });
                            response = { title: 'Success! :white_check_mark:', description: `Moved <#${target.id}> to **${category.name}**.` };
                        });
                    }
                }
            } catch {
                failure = `I couldn't finish ${name}. Check my permissions and try again.`;
            }
            if (failure) await reply(failure);
            else if (response) await success(response.title, response.description);
        },
    }));
}

export const prefixCommands: readonly PrefixCommand[] = createChannelManagerCommands();
export const slashCommands: readonly SlashCommand[] = [];
