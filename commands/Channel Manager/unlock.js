
module.exports = {
    name: "unlock",
    aliases: ["ul"],
    usage: "sm unlock",
    category: "Channel Manager",
    description: "Unlock your channel!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const embed = new client.discord.EmbedBuilder()
            .setTitle("Unlock - Channel Manager")
            .addFields({name: `👋 Hey ${message.author.username}`, value: "This command (and half of Channel Manager commands) is officially discontinued. Thank you for supporting my work!"})
            .setColor(client.config.embedColor)
            .setFooter({ text: `${client.config.embedFooterText1}`})
            .setTimestamp();
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser : false} });
    }
}