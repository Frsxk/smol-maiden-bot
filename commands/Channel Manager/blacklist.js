const { PermissionFlagsBits } = require('discord.js');
const {
    requireOwnership,
    resolveTarget,
    getBotId,
    fetchFreshChannel,
    safeReply,
    describeApplyFailure,
} = require('../../utils/channelManager');
const { applyChannelState, withChannelLock } = require('../../utils/channelPermissions');

module.exports = {
    name: 'blacklist',
    aliases: ['bl', 'uninvite'],
    usage: 'sm blacklist add/remove [user]',
    category: 'Channel Manager',
    description: "Deny a member access until removed from the blacklist. Administrators bypass these restrictions.",
    ownerOnly: false,
    run: async (client, message, args) => {
        return withChannelLock(message.channel.id, async () => {
            try {
                const { doc, error } = await requireOwnership(message, client);
                if (error === 'db') {
                    return safeReply(message, { content: 'The channel registry is unavailable right now. Try again in a moment.' });
                }
                if (error === 'nochannel') {
                    return safeReply(message, { content: 'This channel has no owner. Use `sm claim` in your personal channel first!' });
                }
                if (error === 'notowner') {
                    return safeReply(message, { content: "Only the channel owner, a server admin, or the bot owner can manage this channel's blacklist." });
                }

                const action = (args[0] || '').toLowerCase();
                if (action !== 'add' && action !== 'remove') {
                    return safeReply(message, { content: 'Usage: `sm blacklist add/remove [user]`' });
                }

                const blacklist = Array.isArray(doc.blacklist) ? doc.blacklist.map(String) : [];
                const whitelist = Array.isArray(doc.whitelist) ? doc.whitelist.map(String) : [];
                if (action === 'remove' && !args[1] && blacklist.length === 0) {
                    return safeReply(message, { content: 'The blacklist is already empty!' });
                }
                if (action === 'remove' && !args[1]) {
                    const list = blacklist.map((id, index) => `**${index + 1}.** <@${id}> (\`${id}\`)`).join('\n');
                    return safeReply(message, {
                        embeds: [new client.discord.EmbedBuilder()
                            .setTitle('📋 Blacklist - Channel Manager')
                            .addFields(
                                { name: 'Blacklisted users', value: list || 'Nobody yet!' },
                                { name: 'Remove someone', value: 'Use `sm blacklist remove <user>` to unblacklist them.' },
                            )
                            .setColor(client.config.embedColor)
                            .setFooter({ text: `${client.config.embedFooterText1}` })
                            .setTimestamp()],
                    });
                }

                const requireMember = action === 'add';
                const resolved = await resolveTarget(message, args[1], {
                    requireMember,
                    knownIds: action === 'remove' ? blacklist : [],
                });
                if (resolved.error === 'missing') {
                    return safeReply(message, { content: 'Please mention a user, their ID, or their username! Usage: `sm blacklist add/remove [user]`' });
                }
                if (resolved.error === 'notmember') {
                    return safeReply(message, { content: 'That user must be a current member of this server to be blacklisted.' });
                }
                if (resolved.error === 'lookupfailed') {
                    return safeReply(message, { content: "I couldn't check that user's membership with Discord. Try again in a moment." });
                }
                if (resolved.error === 'notfound') {
                    const hint = action === 'remove'
                        ? ' If they left the server, remove them by ID or mention instead.'
                        : ' Try a mention, ID, or exact username.';
                    return safeReply(message, { content: `I couldn't find that user.${hint}` });
                }

                const targetId = String(resolved.id);

                if (action === 'add') {
                    if (targetId === String(doc.userId)) {
                        return safeReply(message, { content: "You can't blacklist the channel owner." });
                    }

                    const botId = getBotId(client, message);
                    if (botId && targetId === botId) {
                        return safeReply(message, { content: "You can't blacklist the bot." });
                    }

                    if (message.guild && message.guild.ownerId !== undefined
                        && String(message.guild.ownerId) === targetId) {
                        return safeReply(message, { content: "You can't blacklist the server owner." });
                    }

                    const member = resolved.member;
                    if (member && member.permissions && typeof member.permissions.has === 'function'
                        && member.permissions.has(PermissionFlagsBits.Administrator)) {
                        return safeReply(message, { content: "You can't blacklist a server administrator." });
                    }

                    if (targetId === String(message.author.id)) {
                        return safeReply(message, { content: "You can't blacklist yourself." });
                    }

                    if (blacklist.includes(targetId)) {
                        return safeReply(message, { content: `<@${targetId}> is already blacklisted!` });
                    }

                    const nextWhitelist = whitelist.filter((id) => id !== targetId);
                    const nextBlacklist = [...blacklist, targetId];
                    const fresh = await fetchFreshChannel(message);
                    if (fresh.error) {
                        return safeReply(message, { content: "I couldn't refresh this channel's permissions from Discord. Nothing was changed; try again." });
                    }

                    const result = await applyChannelState(
                        fresh.channel,
                        doc,
                        { locked: Boolean(doc.locked), whitelist: nextWhitelist, blacklist: nextBlacklist },
                        botId,
                        `Channel Manager: blacklist add ${targetId}`,
                    );
                    if (!result.ok) {
                        return safeReply(message, { content: describeApplyFailure(result) });
                    }

                    return safeReply(message, { content: `Added <@${targetId}> to the blacklist. They can no longer see this channel.` });
                }

                if (!blacklist.includes(targetId)) {
                    return safeReply(message, { content: `<@${targetId}> isn't on the blacklist!` });
                }

                const nextBlacklist = blacklist.filter((id) => id !== targetId);
                const fresh = await fetchFreshChannel(message);
                if (fresh.error) {
                    return safeReply(message, { content: "I couldn't refresh this channel's permissions from Discord. Nothing was changed; try again." });
                }

                const result = await applyChannelState(
                    fresh.channel,
                    doc,
                    { locked: Boolean(doc.locked), whitelist, blacklist: nextBlacklist },
                    getBotId(client, message),
                    `Channel Manager: blacklist remove ${targetId}`,
                );
                if (!result.ok) {
                    return safeReply(message, { content: describeApplyFailure(result) });
                }

                return safeReply(message, { content: `Removed <@${targetId}> from the blacklist. Their previous view permissions apply again; a locked channel still requires a whitelist exception.` });
            } catch (error) {
                console.error('[Channel Manager] blacklist failed:', error && error.message ? error.message : error);
                return safeReply(message, { content: "I couldn't finish updating the blacklist. Check the channel's permissions before trying again." });
            }
        });
    },
};
