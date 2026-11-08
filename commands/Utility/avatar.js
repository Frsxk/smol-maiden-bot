
module.exports = {
    name: "avatar",
    aliases: ["av", "profile", "pfp"],
    usage: "sm avatar <user>",
    category: "Bot",
    description: "Enlarge someone's avatar!",
    ownerOnly: false,
    run: async (client, message, args) => {
        let name;
        let tag;
        const auth = message.author;
        let authTag;
        let servUser;
        const timelimit = 120000;

        const buttons = new client.discord.ActionRowBuilder()
            .addComponents(
                new client.discord.ButtonBuilder()
                    .setCustomId('user')
                    .setLabel("User Avatar")
                    .setStyle(client.discord.ButtonStyle.Success)
                    .setDisabled(true),
                new client.discord.ButtonBuilder()
                    .setCustomId('server')
                    .setLabel("Server Avatar")
                    .setStyle(client.discord.ButtonStyle.Secondary)
                    .setDisabled(true)
            );
        const userBtn = buttons.components[0];
        const serverBtn = buttons.components[1];

        if (!args[0]) {
            name = message.author;
        } else {
            const searchName = args.join(" ");
            name = client.users.cache.find(u => u.tag === searchName) ||
                client.users.cache.find(u => u.username === searchName) ||
                await client.users.fetch(args[0]).catch(() => null) ||
                message.mentions.users.first();
        }
        if (name == null || !name) {
            const errEmbed = new client.discord.EmbedBuilder()
                .addFields({name: "Failed! :no_entry_sign:", value: `I couldn't find a user matching \`${args.join(" ")}\`. Give a mention, user ID, or exact username. Usernames are case-sensitive.`})
                .setColor(client.config.embedColor)
                .setTimestamp()
                .setFooter({text: `${client.config.embedFooterText1}`});
            return message.reply({embeds: [errEmbed], allowedMentions: {repliedUser : false} }); 
        }

        // Server avatars belong to the guild member, not the user.
        servUser = message.guild.members.cache.find(u => u.id == name.id);
        if (servUser.avatar != null || !servUser) {
            serverBtn.setDisabled(false);
        }

        // New usernames have discriminator "0", and their tag is undefined.
        if (name.discriminator == '0') {
            tag = name.username
        } else {
            tag = name.tag
        }
        if (auth.discriminator == '0') {
            authTag = auth.username
        } else {
            authTag = auth.tag
        }

        const newEmbed = new client.discord.EmbedBuilder()
            .setTitle(`${tag}'s avatar`)
            .setImage(name.displayAvatarURL({size: 4096}))
            .setColor(client.config.embedColor)
            .setTimestamp()
            .setFooter({text: `Requested by ${authTag}`, iconURL: `${auth.displayAvatarURL()}`});
        await message.reply({embeds: [newEmbed], allowedMentions: {repliedUser : false}, components: [buttons]});

        client.on('interactionCreate', i => {
            const timeoutFunction = () => {
                serverBtn.setDisabled(true);
                userBtn.setDisabled(true);
                i.message.edit({content: "_This message is now inactive_", embeds: [newEmbed], components: [buttons], allowedMentions: {repliedUser: false}});
            }

            const timeout = setTimeout(timeoutFunction, timelimit);

            if (i.customId === 'server') {
                newEmbed.setImage(servUser.displayAvatarURL({size: 4096}));
                serverBtn.setDisabled(true).setStyle(client.discord.ButtonStyle.Success);
                userBtn.setDisabled(false).setStyle(client.discord.ButtonStyle.Secondary);
                i.update({embeds: [newEmbed], components: [buttons]});
            }
            if (i.customId === 'user') {
                newEmbed.setImage(name.displayAvatarURL({size: 4096}));
                userBtn.setDisabled(true).setStyle(client.discord.ButtonStyle.Success);
                serverBtn.setDisabled(false).setStyle(client.discord.ButtonStyle.Secondary);
                i.update({embeds: [newEmbed], components: [buttons]});
            }

            clearTimeout();
        })
    }
}
