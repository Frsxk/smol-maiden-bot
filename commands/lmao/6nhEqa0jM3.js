
module.exports = {
    name: "6nhEqa0jM3",
    usage: "this command is none of your business",
    category: "lmao",
    description: "This command will return [⁎✲ﾟ Loli's Fantasy *｡⋆♡](https://discord.com/invite/2SatpX28ZX)'s server rules.\nBy the way, how did you manage to get this command's name?",
    ownerOnly: true,
    run: async (client, message, args) => {

        const rulesCh = message.guild.channels.cache.find(channel => channel.id === '1041206376573177908');
        const rulemsg = await rulesCh.messages.fetch('1052407837344661524');
        const embed = new client.discord.EmbedBuilder()
            .setTitle("⁎✲ﾟ Loli's Fantasy *｡⋆♡ | Server Rules")
            .addFields(
                { name: "Here are the rules for this server!", value: `1. Follow Discord [ToS](https://discord.com/tos) and [Community Guidelines](https://discord.com/guidelines)\n2. Don't be rude, try to respect everyone.\n3. No NSFW content outside NSFW channel (This includes your username, your about me, your status, etc.)\n4. Do not abuse any bugs found by you or anyone else. Report bugs by DMing <@!543313602942337035> (\@frxskie)\n5. Use common sense.`})
            .setDescription(`Failure to follow the rules may lead you to get banned from the server!`)
            .setColor(client.config.embedColor)
            .setFooter({ text: "Last Updated" })
            .setTimestamp();
        rulemsg.edit({ embeds: [embed] });
    }
}