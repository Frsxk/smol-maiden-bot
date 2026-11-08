
module.exports = {
    name: "upgrade",
    aliases: ["up", "upg"],
    usage: `sm upgrade <#channel>`,
    category: "Channel Manager",
    description: "Move your channel to the next category!",
    ownerOnly: false,
    run: async (client, message, args) => {
        const chnl = message.mentions.channels.first();
        const cate3 = message.guild.channels.cache.find(channel => channel.id === '954368431329787924');
        const cate2 = message.guild.channels.cache.find(channel => channel.id === '954368406839246908');
        const cate1 = message.guild.channels.cache.find(channel => channel.id === '954368368037740564');
        const cateTop = message.guild.channels.cache.find(channel => channel.id === '957508834434351114');
        const lvl1 = message.guild.roles.cache.find(role => role.name === "level 1");
        const lvl2 = message.guild.roles.cache.find(role => role.name === "level 2");
        const lvl3 = message.guild.roles.cache.find(role => role.name === "level 3");

        function moveChannel(category) {
            chnl.setParent(category).then(ch => {
                const embed = new client.discord.EmbedBuilder()
                    .addFields({name: 'Success! :white_check_mark:', value: `Moved ${args[0]} to **${ch.parent.name}**.`})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`})
                    .setTimestamp();
                return message.reply({ embeds: [embed], allowedMentions: { repliedUser : false } })
            }).catch(console.error)
        }
        function missingRole(role) {
            const errrorEmbed1 = new client.discord.EmbedBuilder()
                .setTitle('Failed! :no_entry_sign:')
                .addFields({name: `You need the role '${role.name}' to move your channel to the next category.`, value: "Usage: sm upgrade <#channel>"})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`})
                .setTimestamp();
            return message.reply({ embeds: [errrorEmbed1], allowedMentions: { repliedUser : false } });
        }
        
        if (!chnl) {
            const errorEmbed = new client.discord.EmbedBuilder()
                .setTitle('Failed! :no_entry_sign:')
                .addFields({name: "Mention the channel you want to move.", value: "Usage: sm upgrade <#channel>", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`})
                .setTimestamp();
            return message.reply({ embeds: [errorEmbed], allowedMentions: { repliedUser : false } });
        }

        if (chnl) {
            if (chnl.parent == cate1) {
                if (message.member.roles.cache.some(role => role.name === 'level 3')) {
                    moveChannel(cateTop);
                } else {
                    missingRole(lvl3);
                }
            }
            if (chnl.parent == cate2) {
                if (message.member.roles.cache.some(role => role.name === 'level 2')) {
                    moveChannel(cate1);
                } else {
                    missingRole(lvl2);
                }
            }
            if (chnl.parent == cate3) {
                if (message.member.roles.cache.some(role => role.name === 'level 1')) {
                    moveChannel(cate2);
                } else {
                    missingRole(lvl1);
                }
            }
            
            if(chnl.parent !== (cate1 || cate2 || cate3)) {
                const errEmbed = new client.discord.EmbedBuilder()
                    .setTitle("Failed! :no_entry_sign:")
                    .addFields({ name: "That channel isn't in a category this command can upgrade.", value: "Pick a channel from the levelling categories.", inline: true })
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText1} `})
                    .setTimestamp();
                return message.reply({embeds: [errEmbed], allowedMentions: { repliedUser: false }});
            }
        }
    }

}
