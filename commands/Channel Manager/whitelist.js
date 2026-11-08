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
    name: 'whitelist',
    aliases: ['wl', 'invite'],
    usage: 'sm whitelist add/remove [user]',
    category: 'Channel Manager',
    description: "Let a member see your channel while it is locked.",
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
                    return safeReply(message, { content: "Only the channel owner, a server admin, or the bot owner can manage this channel's whitelist." });
                }

                const action = (args[0] || '').toLowerCase();
                if (action !== 'add' && action !== 'remove') {
                    return safeReply(message, { content: 'Usage: `sm whitelist add/remove [user]`' });
                }

                const whitelist = Array.isArray(doc.whitelist) ? doc.whitelist.map(String) : [];
                if (action === 'remove' && !args[1] && whitelist.length === 0) {
                    return safeReply(message, { content: 'The whitelist is already empty!' });
                }
                if (action === 'remove' && !args[1]) {
                    const list = whitelist.map((id, index) => `**${index + 1}.** <@${id}> (\`${id}\`)`).join('\n');
                    return safeReply(message, {
                        embeds: [new client.discord.EmbedBuilder()
                            .setTitle('📋 Whitelist - Channel Manager')
                            .addFields(
                                { name: 'Whitelisted users', value: list || 'Nobody yet!' },
                                { name: 'Remove someone', value: 'Use `sm whitelist remove <user>` to remove them.' },
                            )
                            .setColor(client.config.embedColor)
                            .setFooter({ text: `${client.config.embedFooterText1}` })
                            .setTimestamp()],
                    });
                }

                const requireMember = action === 'add';
                const resolved = await resolveTarget(message, args[1], {
                    requireMember,
                    knownIds: action === 'remove' ? whitelist : [],
                });
                if (resolved.error === 'missing') {
                    return safeReply(message, { content: 'Please mention a user, their ID, or their username! Usage: `sm whitelist add/remove [user]`' });
                }
                if (resolved.error === 'notmember') {
                    return safeReply(message, { content: 'That user must be a current member of this server to be whitelisted.' });
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

                if (targetId === String(doc.userId)) {
                    return safeReply(message, { content: "The channel owner already has access while the channel is locked." });
                }

                if (action === 'add') {
                    if (Array.isArray(doc.blacklist) && doc.blacklist.map(String).includes(targetId)) {
                        return safeReply(message, { content: `<@${targetId}> is blacklisted. Remove them from the blacklist before whitelisting them.` });
                    }
                    if (whitelist.includes(targetId)) {
                        return safeReply(message, { content: `<@${targetId}> is already whitelisted!` });
                    }

                    const nextWhitelist = [...whitelist, targetId];
                    const fresh = await fetchFreshChannel(message);
                    if (fresh.error) {
                        return safeReply(message, { content: "I couldn't refresh this channel's permissions from Discord. Nothing was changed; try again." });
                    }

                    const result = await applyChannelState(
                        fresh.channel,
                        doc,
                        { locked: Boolean(doc.locked), whitelist: nextWhitelist, blacklist: doc.blacklist || [] },
                        getBotId(client, message),
                        `Channel Manager: whitelist add ${targetId}`,
                    );
                    if (!result.ok) {
                        return safeReply(message, { content: describeApplyFailure(result) });
                    }

                    const suffix = doc.locked ? ' They can see the locked channel now.' : '';
                    return safeReply(message, { content: `Added <@${targetId}> to the whitelist.${suffix}` });
                }

                if (!whitelist.includes(targetId)) {
                    return safeReply(message, { content: `<@${targetId}> isn't on the whitelist!` });
                }

                const nextWhitelist = whitelist.filter((id) => id !== targetId);
                const fresh = await fetchFreshChannel(message);
                if (fresh.error) {
                    return safeReply(message, { content: "I couldn't refresh this channel's permissions from Discord. Nothing was changed; try again." });
                }

                const result = await applyChannelState(
                    fresh.channel,
                    doc,
                    { locked: Boolean(doc.locked), whitelist: nextWhitelist, blacklist: doc.blacklist || [] },
                    getBotId(client, message),
                    `Channel Manager: whitelist remove ${targetId}`,
                );
                if (!result.ok) {
                    return safeReply(message, { content: describeApplyFailure(result) });
                }

                const suffix = doc.locked ? ' They no longer have a whitelist exception. Administrators still bypass channel restrictions.' : '';
                return safeReply(message, { content: `Removed <@${targetId}> from the whitelist.${suffix}` });
            } catch (error) {
                console.error('[Channel Manager] whitelist failed:', error && error.message ? error.message : error);
                return safeReply(message, { content: "I couldn't finish updating the whitelist. Check the channel's permissions before trying again." });
            }
        });
    },
};
