const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: "pin",
    aliases: ["p"],
    usage: "sm pin <message ID>",
    category: "Channel Manager",
    description: "Pin a message in this channel.\nTo copy a message ID, enable [Developer Mode](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID-). You'll find it under User Settings -> Advanced (or Behavior on mobile).",
    ownerOnly: false,
    run: async (client, message, args) => {
        const member = message.member;
        if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages) || (message.author.id == client.config.ownerID)) {
            const errEmbed = new client.discord.EmbedBuilder()
                .addFields({name: "Failed! :no_entry_sign:", value: `I couldn't pin a message with the ID \`${args[0]}\`. Check that the ID is valid and that I can manage pins here.`})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});

            const pinEmbed = new client.discord.EmbedBuilder()
                .setTitle('Failed! :no_entry_sign:')
                .addFields({name: "Which message should I pin?", value: "Reply to it, or use: `sm pin <message ID>`", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});

            try {
                if (!args[0]) {
                    if (message.reference) {
                        message.channel.messages.pin(message.reference.messageId);
                        return message.react('✅');
                    } else {
                        return message.reply({ embeds: [pinEmbed], allowedMentions: { repliedUser : false } });
                    }
                }
    
                if (Number(args[0])) {
                    const msg = args[0];
                    message.channel.messages.pin(msg);
                    return message.react('✅');
                } else if (args[0].includes('https://')) {
                    message.channel.messages.pin(args[0].slice(67));
                    return message.react('✅');
                } else {
                    return message.reply({ embeds: [pinEmbed], allowedMentions: { repliedUser : false } });
                }
            } 
            catch (err) {
                await message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser : false } });
                console.log(err);
            }
        } else {
            const erm = new client.discord.EmbedBuilder()
                .setTitle("Failed! :no_entry_sign:")
                .addFields({name: "You need Manage Messages to pin messages here.", value: "Usage: `sm pin <message ID>`", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});
            return message.reply({ embeds: [erm], allowedMentions: {repliedUser : false}});
        }
    }
}
