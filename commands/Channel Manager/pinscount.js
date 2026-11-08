
module.exports = {
    name: "pinscount",
    aliases: ["pc"],
    usage: "sm pinscount",
    category: "Channel Manager",
    description: "Count the pinned messages in a channel.",
    ownerOnly: false,
    run: async (client, message, args) => {
        const chnl = message.mentions.channels.first() || client.channels.resolve(args[0]);

        if (chnl) {
            if (message.author.id !== client.config.ownerID) {
                const pingEmbed = new client.discord.EmbedBuilder()
                    .addFields({name: `Hey ${message.author.username}`, value: "Only the bot owner can check another channel's pins. Run this command without arguments to check the current channel."})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`})
                    .setTimestamp();
                await message.reply({ embeds: [pingEmbed], allowedMentions: {repliedUser: false } });

            } else {
                const msg = await message.channel.send(`📝 Fetching pinned messages...`);

                chnl.messages.fetchPins()
                .then(pins => {
                    const pingEmbed = new client.discord.EmbedBuilder()
                        .addFields({name: "Success! :white_check_mark:", value: `Fetched ${pins.items.length} pinned messages from <#${chnl.id}>.\nThis command counts the first page only.`})
                        .setColor(client.config.embedColor)
                        .setFooter({text: `${client.config.embedFooterText1}`})
                        .setTimestamp();
                    message.reply({ embeds: [pingEmbed], allowedMentions: { repliedUser: false } });
                })
                .catch(console.error)

                msg.delete();
            }

        } else {
            const msg = await message.channel.send(`📝 Fetching pinned messages...`);
            message.channel.messages.fetchPins()
            .then(pins => {
                const pingEmbed = new client.discord.EmbedBuilder()
                    .addFields({name: "Success! :white_check_mark:", value: `Fetched ${pins.items.length} pinned messages from <#${message.channel.id}>.\nThis command counts the first page only.`})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`})
                    .setTimestamp();
                message.reply({ embeds: [pingEmbed], allowedMentions: { repliedUser: false }});
            })
            .catch(console.error)

            msg.delete();
        }
    }
}
