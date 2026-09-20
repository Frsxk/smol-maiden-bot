const { requireOwnership } = require('../../utils/channelManager');

module.exports = {
    name: "unlock",
    aliases: ["ul"],
    usage: "sm unlock",
    category: "Channel Manager",
    description: "Unlock your channel — makes it visible to everyone again!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const { doc, error } = await requireOwnership(message, client);
        if (error === 'nochannel') {
            return message.reply({ content: "This channel has no owner. Use `sm claim` in your personal channel first!", allowedMentions: { repliedUser: false } });
        }
        if (error === 'notowner') {
            return message.reply({ content: "Only the channel owner (or a server admin) can unlock this channel!", allowedMentions: { repliedUser: false } });
        }

        if (!doc.locked) {
            return message.reply({ content: "This channel isn't locked!", allowedMentions: { repliedUser: false } });
        }

        const channel = message.channel;

        // Restore @everyone visibility; blacklisted users stay denied
        await channel.permissionOverwrites.delete(channel.guild.roles.everyone).catch(() => null);
        await channel.permissionOverwrites.delete(doc.userId).catch(() => null);
        for (const userId of doc.whitelist) {
            await channel.permissionOverwrites.delete(userId).catch(() => null);
        }

        doc.locked = false;
        await doc.save();

        const embed = new client.discord.EmbedBuilder()
            .setTitle("🔓 Unlock - Channel Manager")
            .addFields({ name: "Success! ✅", value: `Unlocked <#${channel.id}>. Everyone can see it again!` })
            .setColor(client.config.embedColor)
            .setFooter({ text: `${client.config.embedFooterText1}` })
            .setTimestamp();
        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    }
}
