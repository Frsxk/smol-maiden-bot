
module.exports = {
    name: "create-channel",
    aliases: ['createch', 'newch'],
    usage: "sm create-channel <channel-name>",
    category: "Channel Manager",
    description: "Create a new channel! This command can only be used by admin.",
    ownerOnly: true,
    run: async (client, message, args) => {
        if (!args[0]){
            return message.reply({ content: `Please provide a channel name!`, allowedMentions: { repliedUser : false } });
        }

        const category = message.guild.channels.cache.find(channel => channel.id === '954368431329787924');
        message.guild.channels.create({ name: args.join('-'), type: client.discord.ChannelType.GuildText, parent: category.id }).then(ch => {
            const embed = new client.discord.EmbedBuilder()
                .setTitle("📜 Channel Create")
                .addFields({name: `Success! ✅`, value: `Successfully created <#${ch.id}> in **${ch.parent.name}** category!`})
                .setColor(client.config.embedColor)
                .setFooter({ text: `${client.config.embedFooterText1}`})
                .setTimestamp();
            return message.reply({ embeds: [embed], allowedMentions: { repliedUser : false } });
        });
    }
}
