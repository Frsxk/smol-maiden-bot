const { ChannelType, PermissionFlagsBits } = require('discord.js');
const OwnedChannel = require('../../models/OwnedChannel');
const {
    isDbReady,
    safeReply,
    checkChannelPresence,
} = require('../../utils/channelManager');

const REQUIRED_BOT_PERMISSIONS = [
    ['View Channel', PermissionFlagsBits.ViewChannel],
    ['Send Messages', PermissionFlagsBits.SendMessages],
    ['Manage Roles', PermissionFlagsBits.ManageRoles],
];

async function getBotMember(message) {
    const members = message.guild && message.guild.members;
    if (!members) return null;
    if (typeof members.fetchMe === 'function') return members.fetchMe();
    return members.me || null;
}

function failureEmbed(client, text) {
    return new client.discord.EmbedBuilder()
        .addFields({ name: 'Cannot claim channel', value: text })
        .setColor(client.config.embedColor)
        .setFooter({ text: `${client.config.embedFooterText1}` })
        .setTimestamp();
}

module.exports = {
    name: 'claim',
    aliases: [],
    usage: 'sm claim',
    category: 'Channel Manager',
    description: "Claim this text channel. Requires Manage Channels; one channel per user.",
    ownerOnly: false,
    run: async (client, message, args) => {
        try {
            if (!isDbReady()) {
                return safeReply(message, { content: 'The channel registry is unavailable right now. Try again in a moment.' });
            }

            const channel = message.channel;

            // Threads and non-text channels can never be personal channels.
            if (typeof channel.isThread === 'function' && channel.isThread()) {
                return safeReply(message, { content: 'Threads cannot be claimed. Use `sm claim` in a regular text channel.' });
            }
            if (channel.type !== undefined && channel.type !== ChannelType.GuildText) {
                return safeReply(message, { content: 'Only regular text channels can be claimed.' });
            }

            // Claiming is a channel-level action. Server owner status or being
            // the bot owner is not enough on its own; the caller needs
            // Manage Channels on this specific channel.
            const callerPermissions = message.member && typeof message.member.permissionsIn === 'function'
                ? message.member.permissionsIn(channel)
                : null;
            if (!callerPermissions || !callerPermissions.has(PermissionFlagsBits.ManageChannels)) {
                return safeReply(message, { content: 'You need **Manage Channels** on this channel to claim it.' });
            }

            let botMember;
            try {
                botMember = await getBotMember(message);
            } catch (error) {
                return safeReply(message, { content: "I couldn't check my permissions in this channel. Try again in a moment." });
            }
            if (!botMember || typeof botMember.permissionsIn !== 'function') {
                return safeReply(message, { content: "I couldn't check my permissions in this channel. Try again in a moment." });
            }

            const botPermissions = botMember.permissionsIn(channel);
            const missing = REQUIRED_BOT_PERMISSIONS
                .filter(([, bit]) => !botPermissions.has(bit))
                .map(([name]) => name);
            if (missing.length) {
                return safeReply(message, {
                    content: `I need ${missing.join(', ')} in this channel before it can be claimed.`,
                });
            }

            let existingUser = await OwnedChannel.findOne({ userId: String(message.author.id) }).exec();
            if (existingUser) {
                if (String(existingUser.channelId) === String(channel.id)) {
                    return safeReply(message, {
                        embeds: [failureEmbed(client, `You already own <#${existingUser.channelId}>.`)],
                    });
                }

                // Only the same guild can be probed for a deleted channel.
                // A cross-guild record is kept: ownership is global.
                if (String(existingUser.guildId) === String(message.guild.id)) {
                    const presence = await checkChannelPresence(message.guild, existingUser.channelId);
                    if (presence === 'error') {
                        return safeReply(message, {
                            content: 'I couldn\'t verify your existing channel with Discord. Nothing was changed; try again in a moment.',
                        });
                    }
                    if (presence === 'missing') {
                        if (typeof OwnedChannel.deleteOne !== 'function') {
                            return safeReply(message, {
                                content: 'Your previous channel no longer exists, but its registry entry could not be cleaned up. Ask an operator to remove it.',
                            });
                        }
                        const deletion = OwnedChannel.deleteOne({ _id: existingUser._id });
                        if (deletion && typeof deletion.exec === 'function') await deletion.exec();
                        else await deletion;
                        existingUser = null;
                    }
                }

                if (existingUser) {
                    const where = String(existingUser.guildId) === String(message.guild.id)
                        ? `<#${existingUser.channelId}>`
                        : 'another server';
                    return safeReply(message, {
                        embeds: [failureEmbed(client, `You already own a channel (${where}). Each user can own one channel.`)],
                    });
                }
            }

            const existingChannel = await OwnedChannel.findOne({ channelId: String(channel.id) }).exec();
            if (existingChannel) {
                return safeReply(message, {
                    embeds: [failureEmbed(client, `This channel is already owned by <@${existingChannel.userId}>.`)],
                });
            }

            try {
                await OwnedChannel.create({
                    userId: String(message.author.id),
                    guildId: String(message.guild.id),
                    channelId: String(channel.id),
                });
            } catch (error) {
                if (error && (Number(error.code) === 11000 || error.code === '11000')) {
                    const pattern = error.keyPattern || error.keyValue || {};
                    if (pattern.userId !== undefined) {
                        return safeReply(message, {
                            embeds: [failureEmbed(client, 'You already own a channel. Each user can own one channel.')],
                        });
                    }
                    if (pattern.channelId !== undefined) {
                        return safeReply(message, {
                            embeds: [failureEmbed(client, 'This channel was just claimed by someone else.')],
                        });
                    }
                    return safeReply(message, {
                        embeds: [failureEmbed(client, 'That claim conflicts with an existing channel registration.')],
                    });
                }
                throw error;
            }

            const embed = new client.discord.EmbedBuilder()
                .setTitle('Channel claimed')
                .addFields({
                    name: 'Registered',
                    value: `<#${channel.id}> is now **${message.author.username}'s** channel!\nYou can now use \`sm lock\`, \`sm unlock\`, \`sm whitelist\` and \`sm blacklist\` here.`,
                })
                .setColor(client.config.embedColor)
                .setFooter({ text: `${client.config.embedFooterText1}` })
                .setTimestamp();
            return safeReply(message, { embeds: [embed] });
        } catch (error) {
            console.error('[Channel Manager] claim failed:', error && error.message ? error.message : error);
            return safeReply(message, { content: 'The claim failed because of an unexpected error.' });
        }
    },
};
