const { requireOwnership } = require('../../utils/channelManager');

module.exports = {
    name: "lock",
    aliases: ["l"],
    usage: "sm lock",
    category: "Channel Manager",
    description: "Lock your channel — hides it from everyone except whitelisted users!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const { doc, error } = await requireOwnership(message, client);
        if (error === 'nochannel') {
            return message.reply({ content: "This channel has no owner. Use `sm claim` in your personal channel first!", allowedMentions: { repliedUser: false } });
        }
        if (error === 'notowner') {
            return message.reply({ content: "Only the channel owner (or a server admin) can lock this channel!", allowedMentions: { repliedUser: false } });
        }

        if (doc.locked) {
            return message.reply({ content: "This channel is already locked!", allowedMentions: { repliedUser: false } });
        }

        const channel = message.channel;

        // Hide from @everyone, then keep the owner + whitelisted users visible
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: false });
        await channel.permissionOverwrites.edit(doc.userId, { ViewChannel: true });
        for (const userId of doc.whitelist) {
            await channel.permissionOverwrites.edit(userId, { ViewChannel: true }).catch(() => null);
        }

        doc.locked = true;
        await doc.save();

        const embed = new client.discord.EmbedBuilder()
            .setTitle("🔒 Lock - Channel Manager")
            .addFields({ name: "Success! ✅", value: `Locked <#${channel.id}>. Only you${doc.whitelist.length ? ` and ${doc.whitelist.length} whitelisted user(s)` : ""} can see it now!` })
            .setColor(client.config.embedColor)
            .setFooter({ text: `${client.config.embedFooterText1}` })
            .setTimestamp();
        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    }
}
