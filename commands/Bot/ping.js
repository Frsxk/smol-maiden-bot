
module.exports = {
    name: "ping",
    aliases: ["pong", "latency"],
    usage: "sm ping",
    category: "Bot",
    description: "Check the bot's ping!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const msg = await message.channel.send(`🏓 Pinging...`);

        const pingEmbed = new client.discord.EmbedBuilder()
            .setTitle(`:signal_strength: ${client.user.username} Ping`)
            .addFields(
                {name: "Time", value: `${Math.floor(msg.createdAt - message.createdAt)}ms`, inline: true},
                {name: "API Ping", value: `${client.ws.ping}ms`, inline: true})
            .setColor(client.config.embedColor)
            .setFooter({ text: `${client.config.embedFooterText1}`})
            .setTimestamp();

        await message.reply({ embeds: [pingEmbed], allowedMentions: { repliedUser: false } });

        msg.delete();
    },
};
