
module.exports = {
    name: "create-channel",
    aliases: ['createch', 'newch'],
    usage: "sm create-channel <channel-name>",
    category: "Channel Manager",
    description: "Create a new channel in the setup category. Bot owner only.",
    ownerOnly: true,
    run: async (client, message, args) => {
        if (!args[0]){
            return message.reply({ content: `Please provide a channel name!`, allowedMentions: { repliedUser : false } });
        }

        const category = message.guild.channels.cache.find(channel => channel.id === '954368431329787924');
        message.guild.channels.create({ name: args.join('-'), type: client.discord.ChannelType.GuildText, parent: category.id }).then(ch => {
            const embed = new client.discord.EmbedBuilder()
                .setTitle("📜 Channel Create")
                .addFields({name: `Success! ✅`, value: `Created <#${ch.id}> in **${ch.parent.name}**.`})
                .setColor(client.config.embedColor)
                .setFooter({ text: `${client.config.embedFooterText1}`})
                .setTimestamp();
            return message.reply({ embeds: [embed], allowedMentions: { repliedUser : false } });
        });
    }
}
