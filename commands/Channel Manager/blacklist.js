
module.exports = {
    name: "blacklist",
    aliases: ["bl", "uninvite"],
    usage: "sm blacklist <@user>",
    category: "Channel Manager",
    description: "Blacklist an user to your channel!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const embed = new client.discord.EmbedBuilder()
            .setTitle("Blacklist - Channel Manager")
            .addFields({name: `👋 Hey ${message.author.username}`, value: "This command (and half of Channel Manager commands) is officially discontinued. Thank you for supporting my work!"})
            .setColor(client.config.embedColor)
            .setFooter({ text: `${client.config.embedFooterText1}`})
            .setTimestamp();
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser : false} });
    }
}