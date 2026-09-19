
module.exports = {
    name: "pinscount",
    aliases: ["pc"],
    usage: "sm pinscount",
    category: "Channel Manager",
    description: "Get the pins count of your channel!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const chnl = message.mentions.channels.first() || client.channels.resolve(args[0]);

        if (chnl) {
            if (message.author.id !== client.config.ownerID) {
                const pingEmbed = new client.discord.EmbedBuilder()
                    .addFields({name: `Hey ${message.author.username}`, value: "You don't have permission to check other channel's pins count. Use this command without arguments to check current channel's pins count!"})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`})
                    .setTimestamp();
                await message.reply({ embeds: [pingEmbed], allowedMentions: {repliedUser: false } });

            } else {
                const msg = await message.channel.send(`📝 Fetching pinned messages...`);

                chnl.messages.fetchPins()
                .then(pins => {
                    const pingEmbed = new client.discord.EmbedBuilder()
                        .addFields({name: "Success! :white_check_mark:", value: `<#${chnl.id}> has ${pins.items.length} pinned messages.\nA channel can have up to 50 pinned messages!`})
                        .setColor(client.config.embedColor)
                        .setFooter({text: `${message.author.username} caught cheating 101`})
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
                    .addFields({name: "Success! :white_check_mark:", value: `<#${message.channel.id}> has ${pins.items.length} pinned messages.\nA channel can have up to 50 pinned messages!`})
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