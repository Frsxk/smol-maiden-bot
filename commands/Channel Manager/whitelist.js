const { requireOwnership, resolveTargetMember } = require('../../utils/channelManager');

module.exports = {
    name: "whitelist",
    aliases: ["wl", "invite"],
    usage: "sm whitelist add/remove [user]",
    category: "Channel Manager",
    description: "Whitelist a user to your channel — they can see it even when it's locked!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const { doc, error } = await requireOwnership(message, client);
        if (error === 'nochannel') {
            return message.reply({ content: "This channel has no owner. Use `sm claim` in your personal channel first!", allowedMentions: { repliedUser: false } });
        }
        if (error === 'notowner') {
            return message.reply({ content: "Only the channel owner (or a server admin) can manage this channel's whitelist!", allowedMentions: { repliedUser: false } });
        }

        const action = (args[0] || '').toLowerCase();
        if (action !== 'add' && action !== 'remove') {
            return message.reply({ content: "Usage: `sm whitelist add/remove [user]`", allowedMentions: { repliedUser: false } });
        }

        if (action === 'remove' && !args[1] && doc.whitelist.length === 0) {
            return message.reply({ content: "The whitelist is already empty!", allowedMentions: { repliedUser: false } });
        }
        if (action === 'remove' && !args[1]) {
            // No argument: list the whitelist with the option to remove by picking
            const list = doc.whitelist.map((id, i) => `**${i + 1}.** <@${id}> (\`${id}\`)`).join('\n');
            return message.reply({
                embeds: [new client.discord.EmbedBuilder()
                    .setTitle("�� Whitelist - Channel Manager")
                    .addFields(
                        { name: "Whitelisted users", value: list || "Nobody yet!" },
                        { name: "Remove someone", value: "Use `sm whitelist remove <user>` to remove them." }
                    )
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText1}` })
                    .setTimestamp()],
                allowedMentions: { repliedUser: false }
            });
        }

        const { member, error: resolveError } = await resolveTargetMember(message, args[1]);
        if (resolveError === 'missing') {
            return message.reply({ content: "Please mention a user, their ID, or their username! Usage: `sm whitelist add/remove [user]`", allowedMentions: { repliedUser: false } });
        }
        if (resolveError === 'notfound') {
            return message.reply({ content: "I couldn't find that user. Try a mention, ID, or exact username!", allowedMentions: { repliedUser: false } });
        }

        const targetId = member.id;

        if (member.id === doc.userId) {
            return message.reply({ content: "You can't whitelist yourself — you're the owner, you always have access!", allowedMentions: { repliedUser: false } });
        }

        if (action === 'add') {
            if (doc.blacklist.includes(targetId)) {
                return message.reply({ content: `<@${targetId}> is blacklisted — remove them from the blacklist first (blacklist always wins)!`, allowedMentions: { repliedUser: false } });
            }
            if (doc.whitelist.includes(targetId)) {
                return message.reply({ content: `<@${targetId}> is already whitelisted!`, allowedMentions: { repliedUser: false } });
            }
            doc.whitelist.push(targetId);
            await doc.save();
            if (doc.locked) {
                await message.channel.permissionOverwrites.edit(targetId, { ViewChannel: true }).catch(() => null);
            }
            return message.reply({ content: `✅ Added <@${targetId}> to the whitelist${doc.locked ? " — they can see the locked channel now!" : "!"}`, allowedMentions: { repliedUser: false } });
        }

        // remove
        if (!doc.whitelist.includes(targetId)) {
            return message.reply({ content: `<@${targetId}> isn't on the whitelist!`, allowedMentions: { repliedUser: false } });
        }
        doc.whitelist = doc.whitelist.filter((id) => id !== targetId);
        await doc.save();
        if (doc.locked) {
            // No longer whitelisted while locked: hide the channel from them
            await message.channel.permissionOverwrites.delete(targetId).catch(() => null);
        }
        return message.reply({ content: `✅ Removed <@${targetId}> from the whitelist${doc.locked ? " — they can no longer see the locked channel." : "!"}`, allowedMentions: { repliedUser: false } });
    }
}
