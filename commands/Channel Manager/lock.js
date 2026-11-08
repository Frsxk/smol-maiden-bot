const {
    requireOwnership,
    getBotId,
    fetchFreshChannel,
    safeReply,
    describeApplyFailure,
} = require('../../utils/channelManager');
const { applyChannelState, withChannelLock } = require('../../utils/channelPermissions');

module.exports = {
    name: 'lock',
    aliases: ['l'],
    usage: 'sm lock',
    category: 'Channel Manager',
    description: 'Hide your channel from ordinary members. Owner, bot, and whitelisted members keep access.',
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
                    return safeReply(message, { content: 'Only the channel owner, a server admin, or the bot owner can lock this channel.' });
                }

                const fresh = await fetchFreshChannel(message);
                if (fresh.error) {
                    return safeReply(message, { content: "I couldn't refresh this channel's permissions from Discord. Nothing was changed; try again." });
                }

                const wasLocked = Boolean(doc.locked);
                const result = await applyChannelState(
                    fresh.channel,
                    doc,
                    { locked: true, whitelist: doc.whitelist || [], blacklist: doc.blacklist || [] },
                    getBotId(client, message),
                    `Channel Manager: lock #${fresh.channel.name || fresh.channel.id}`,
                );

                if (!result.ok) {
                    return safeReply(message, { content: describeApplyFailure(result) });
                }

                const whitelisted = result.state.whitelist.length;
                const visibility = whitelisted
                    ? `The channel owner, ${whitelisted} whitelisted member(s), and the bot keep access.`
                    : 'The channel owner and bot keep access.';
                const note = wasLocked
                    ? 'This channel was already locked; permissions were re-applied to match the registry.'
                    : 'Server administrators and the server owner can still see it because Discord grants them access.';

                const embed = new client.discord.EmbedBuilder()
                    .setTitle('🔒 Lock - Channel Manager')
                    .addFields({
                        name: 'Success! ✅',
                        value: `Locked <#${message.channel.id}>. ${visibility}\n${note}`,
                    })
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText1}` })
                    .setTimestamp();
                return safeReply(message, { embeds: [embed] });
            } catch (error) {
                console.error('[Channel Manager] lock failed:', error && error.message ? error.message : error);
                return safeReply(message, { content: "I couldn't finish locking this channel. Check its permissions before trying again." });
            }
        });
    },
};
