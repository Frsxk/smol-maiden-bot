const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: "pin",
    aliases: ["p"],
    usage: "sm pin <message ID>",
    category: "Channel Manager",
    description: "Pin a message in your channel!\nYou need to enable [Developer Mode](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID-) to copy the ID of message. Developer mode is located at User Settings -> Advanced (or Behavior for mobile).",
    ownerOnly: false,
    run: async (client, message, args) => {
        const member = message.member;
        if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages) || (message.author.id == client.config.ownerID)) {
            const errEmbed = new client.discord.EmbedBuilder()
                .addFields({name: "Failed! :no_entry_sign:", value: `An error occurred when trying to find message \`${args[0]}\`. Please make sure you provide a valid message ID.`})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});

            const pinEmbed = new client.discord.EmbedBuilder()
                .setTitle('Failed! :no_entry_sign:')
                .addFields({name: "Please mention the message ID that you want to pin!", value: "Usage: \`sm pin <message ID>\`", inline: true})
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
                .addFields({name: "You don't have permission to pin message(s) in this channel.", value: "Usage: \`sm pin <message ID>\`", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});
            return message.reply({ embeds: [erm], allowedMentions: {repliedUser : false}});
        }
    }
}
