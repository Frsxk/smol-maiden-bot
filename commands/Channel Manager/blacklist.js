const { requireOwnership, resolveTargetMember } = require('../../utils/channelManager');

module.exports = {
    name: "blacklist",
    aliases: ["bl", "uninvite"],
    usage: "sm blacklist add/remove [user]",
    category: "Channel Manager",
    description: "Blacklist a user from your channel — they can't see it, locked or not, until unblacklisted!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const { doc, error } = await requireOwnership(message, client);
        if (error === 'nochannel') {
            return message.reply({ content: "This channel has no owner. Use `sm claim` in your personal channel first!", allowedMentions: { repliedUser: false } });
        }
        if (error === 'notowner') {
            return message.reply({ content: "Only the channel owner (or a server admin) can manage this channel's blacklist!", allowedMentions: { repliedUser: false } });
        }

        const action = (args[0] || '').toLowerCase();
        if (action !== 'add' && action !== 'remove') {
            return message.reply({ content: "Usage: `sm blacklist add/remove [user]`", allowedMentions: { repliedUser: false } });
        }

        if (action === 'remove' && !args[1] && doc.blacklist.length === 0) {
            return message.reply({ content: "The blacklist is already empty!", allowedMentions: { repliedUser: false } });
        }
        if (action === 'remove' && !args[1]) {
            const list = doc.blacklist.map((id, i) => `**${i + 1}.** <@${id}> (\`${id}\`)`).join('\n');
            return message.reply({
                embeds: [new client.discord.EmbedBuilder()
                    .setTitle("�� Blacklist - Channel Manager")
                    .addFields(
                        { name: "Blacklisted users", value: list || "Nobody yet!" },
                        { name: "Remove someone", value: "Use `sm blacklist remove <user>` to unblacklist them." }
                    )
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText1}` })
                    .setTimestamp()],
                allowedMentions: { repliedUser: false }
            });
        }

        const { member, error: resolveError } = await resolveTargetMember(message, args[1]);
        if (resolveError === 'missing') {
            return message.reply({ content: "Please mention a user, their ID, or their username! Usage: `sm blacklist add/remove [user]`", allowedMentions: { repliedUser: false } });
        }
        if (resolveError === 'notfound') {
            return message.reply({ content: "I couldn't find that user. Try a mention, ID, or exact username!", allowedMentions: { repliedUser: false } });
        }

        const targetId = member.id;

        if (member.id === doc.userId) {
            return message.reply({ content: "You can't blacklist yourself — you're the owner!", allowedMentions: { repliedUser: false } });
        }

        if (action === 'add') {
            if (doc.blacklist.includes(targetId)) {
                return message.reply({ content: `<@${targetId}> is already blacklisted!`, allowedMentions: { repliedUser: false } });
            }
            // Blacklist always wins: pull them off the whitelist if present
            if (doc.whitelist.includes(targetId)) {
                doc.whitelist = doc.whitelist.filter((id) => id !== targetId);
            }
            doc.blacklist.push(targetId);
            await doc.save();
            await message.channel.permissionOverwrites.edit(targetId, { ViewChannel: false }).catch(() => null);
            return message.reply({ content: `✅ Added <@${targetId}> to the blacklist — they can no longer see this channel${doc.locked ? ", even whitelisted or not" : ""}!`, allowedMentions: { repliedUser: false } });
        }

        // remove
        if (!doc.blacklist.includes(targetId)) {
            return message.reply({ content: `<@${targetId}> isn't on the blacklist!`, allowedMentions: { repliedUser: false } });
        }
        doc.blacklist = doc.blacklist.filter((id) => id !== targetId);
        await doc.save();
        // If the channel is locked, un-blacklisting shouldn't make them see it
        // (they're not whitelisted) — remove the overwrite so the @everyone
        // deny applies to them again.
        await message.channel.permissionOverwrites.delete(targetId).catch(() => null);
        return message.reply({ content: `✅ Removed <@${targetId}> from the blacklist — they can see this channel again${doc.locked ? " (unless it's locked — ask the owner to whitelist them)!" : "!"}`, allowedMentions: { repliedUser: false } });
    }
}
