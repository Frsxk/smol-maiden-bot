const {
    requireOwnership,
    getBotId,
    fetchFreshChannel,
    safeReply,
    describeApplyFailure,
} = require('../../utils/channelManager');
const { applyChannelState, withChannelLock } = require('../../utils/channelPermissions');

module.exports = {
    name: 'unlock',
    aliases: ['ul'],
    usage: 'sm unlock',
    category: 'Channel Manager',
    description: "Restore the channel's previous view permissions, keeping blacklist restrictions.",
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
                    return safeReply(message, { content: 'Only the channel owner, a server admin, or the bot owner can unlock this channel.' });
                }

                const fresh = await fetchFreshChannel(message);
                if (fresh.error) {
                    return safeReply(message, { content: "I couldn't refresh this channel's permissions from Discord. Nothing was changed; try again." });
                }

                const wasLocked = Boolean(doc.locked);
                const result = await applyChannelState(
                    fresh.channel,
                    doc,
                    { locked: false, whitelist: doc.whitelist || [], blacklist: doc.blacklist || [] },
                    getBotId(client, message),
                    `Channel Manager: unlock #${fresh.channel.name || fresh.channel.id}`,
                );

                if (!result.ok) {
                    return safeReply(message, { content: describeApplyFailure(result) });
                }

                const status = wasLocked
                    ? 'Lock removed. Permissions were restored to their previous values; blacklisted members stay blocked.'
                    : "No lock was recorded. Leftover permission changes were cleared; pre-existing permissions were restored.";

                const embed = new client.discord.EmbedBuilder()
                    .setTitle('🔓 Unlock - Channel Manager')
                    .addFields({
                        name: 'Success! ✅',
                        value: `Unlocked <#${message.channel.id}>. ${status}`,
                    })
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText1}` })
                    .setTimestamp();
                return safeReply(message, { embeds: [embed] });
            } catch (error) {
                console.error('[Channel Manager] unlock failed:', error && error.message ? error.message : error);
                return safeReply(message, { content: "I couldn't finish unlocking this channel. Check its permissions before trying again." });
            }
        });
    },
};
