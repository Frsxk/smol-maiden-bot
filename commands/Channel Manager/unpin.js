const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: "unpin",
    aliases: ["unp"],
    usage: "sm unpin <message ID>",
    category: "Channel Manager",
    description: "Unpin a message in this channel.\nTo copy a message ID, enable [Developer Mode](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID-). You'll find it under User Settings -> Advanced (or Behavior on mobile).",
    ownerOnly: false,
    run: async (client, message, args) => {
        const member = message.member;
        if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages) || (message.author.id == client.config.ownerID)) {
            const errEmbed = new client.discord.EmbedBuilder()
                .addFields({name: "Failed! :no_entry_sign:", value: `I couldn't unpin a message with the ID \`${args[0]}\`. Check that the ID is valid and that the message is pinned.`})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});

            const unpEmbed = new client.discord.EmbedBuilder()
                .setTitle('Failed! :no_entry_sign:')
                .addFields({name: "Which message should I unpin?", value: "Reply to it, or use: `sm unpin <message ID>`", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});

            const notPinned = new client.discord.EmbedBuilder()
                .addFields({name: "Failed! :no_entry_sign:", value: "That message isn't pinned.", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});

            try {
                if (!args[0]) {
                    if (message.reference) {
                        const msg = await message.channel.messages.fetch(message.reference.messageId);
                        if (msg.pinned) {
                            message.channel.messages.unpin(msg);
                            return message.react('✅');
                        } else {
                            return message.reply({ embeds: [notPinned], allowedMentions: { repliedUser : false } });
                        }
                    } else {
                        return message.reply({ embeds: [unpEmbed], allowedMentions: { repliedUser : false } });
                    }
                }

                if (Number(args[0])) {
                    const msg = await message.channel.messages.fetch(args[0]);
                    if (msg.pinned) {
                        message.channel.messages.unpin(msg);
                        return message.react('✅');
                    } else {
                        return message.reply({ embeds: [notPinned], allowedMentions: { repliedUser : false } });
                    }
                } else if (args[0].includes('https://')) {
                    const msg = await message.channel.messages.fetch(args[0].slice(67));
                    if (msg.pinned) {
                        message.channel.messages.unpin(msg);
                        return message.react('✅');
                    } else {
                        return message.reply({ embeds: [notPinned], allowedMentions: { repliedUser : false } });
                    }
                } else {
                    return message.reply({ embeds: [unpEmbed], allowedMentions: { repliedUser : false } });
                }
            }
            catch (err) {
                await message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser : false } });
                console.log(err);
            }
        } else {
            const erm = new client.discord.EmbedBuilder()
                .setTitle("Failed! :no_entry_sign:")
                .addFields({name: "You need Manage Messages to unpin messages here.", value: "Usage: `sm unpin <message ID>`", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});
            return message.reply({ embeds: [erm], allowedMentions: {repliedUser : false}});
        }
    }

}
