const { ownerID } = require("../../config");

module.exports = {
    name: "info",
    aliases: ["i", "information"],
    usage: "sm info",
    category: "Bot",
    description: "Some information about me, and my owner!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const frxskie = message.guild.members.cache.find(user => user.id === ownerID); // To make owner as a constant
        const row = new client.discord.ActionRowBuilder() // Button components of EmbedBuilder
            .addComponents(
                new client.discord.ButtonBuilder()
                    .setLabel("Discord.js")
                    .setStyle(client.discord.ButtonStyle.Link)
                    .setURL("https://discord.js.org/"),
                new client.discord.ButtonBuilder()
                    .setLabel("D.js Example")
                    .setStyle(client.discord.ButtonStyle.Link)
                    .setURL("https://github.com/Expectatives/Discord.js-v13-Example/"),
                new client.discord.ButtonBuilder()
                    .setLabel("Support Server")
                    .setStyle(client.discord.ButtonStyle.Link)
                    .setURL("https://discord.com/invite/2SatpX28ZX")
            );
        
        let name;
        if (message.author.discriminator == '0') {
            name = message.author.username
        } else {
            name = message.author.tag
        }
        
        const embed = new client.discord.EmbedBuilder()
            .setTitle(`About ${client.user.username}`)
            .addFields({name: `Hello there, ${name}`, value: `Smol Maiden is made by **@${frxskie.user.username}** using Discord.js, and some node modules. This bot is still private at the moment, and is not open sourced. I'm using Discord.js-v13-Example template created by Expectatives on Github. My development is helped by Friends, and countless amount of tutorials.`, inline: true})
            .setColor(client.config.embedColor)
            .setThumbnail(frxskie.displayAvatarURL({ size: 4096 }))
            .setTimestamp()
            .setFooter({ text: `${client.config.embedFooterText}`, iconURL: `${client.user.displayAvatarURL()}` });
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser : false }, components: [row] });
    }
}
