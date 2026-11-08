
module.exports = {
    name: "6nhEqa0jM3",
    usage: "sm 6nhEqa0jM3",
    category: "lmao",
    description: "Update the server rules message in [⁎✲ﾟ Loli's Fantasy *｡⋆♡](https://discord.com/invite/2SatpX28ZX).",
    ownerOnly: true,
    run: async (client, message, args) => {

        const rulesCh = message.guild.channels.cache.find(channel => channel.id === '1041206376573177908');
        const rulemsg = await rulesCh.messages.fetch('1052407837344661524');
        const embed = new client.discord.EmbedBuilder()
            .setTitle("⁎✲ﾟ Loli's Fantasy *｡⋆♡ | Server Rules")
            .addFields(
                { name: "Here are the rules for this server!", value: `1. Follow Discord [ToS](https://discord.com/tos) and [Community Guidelines](https://discord.com/guidelines)\n2. Don't be rude. Respect everyone.\n3. No NSFW content outside the NSFW channel. This includes your username, about me, and status.\n4. Don't abuse bugs. Report them by DMing <@!543313602942337035> (\@frxskie).\n5. Use common sense.`})
            .setDescription(`Breaking these rules can get you banned from the server.`)
            .setColor(client.config.embedColor)
            .setFooter({ text: "Last Updated" })
            .setTimestamp();
        rulemsg.edit({ embeds: [embed] });
    }
}
