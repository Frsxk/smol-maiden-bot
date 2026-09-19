const { readdirSync } = require('fs');

module.exports = {
    name: "list",
    aliases: ["cmd", "ls"],
    usage: "sm list <category>",
    category: "Bot",
    description: "Get the list of a command category!",
    ownerOnly: false,
    run: async (client, message, args) => {
        if (!args[0]) {
            const embed = new client.discord.EmbedBuilder()
                .setTitle(`Command List | ${client.user.username}`)
                .addFields({name: "Please mention the category that you want to see!", value: "Usage: sm list <category>", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        }

        // Copy and pasted from help command
        const botCommandsList = [];
        readdirSync(`${client.cwd}/commands/Bot`).forEach((file) => {
            const filen = require(`../../commands/Bot/${file}`);
            const name = `\`${filen.name}\``
            botCommandsList.push(name);
        });

        const utilityCommandsList = [];
        readdirSync(`${client.cwd}/commands/Utility`).forEach((file) => {
            const filen = require(`../../commands/Utility/${file}`);
            const name = `\`${filen.name}\``
            utilityCommandsList.push(name);
        });

        const channelManagerCommandsList = [];
        readdirSync(`${client.cwd}/commands/Channel Manager`).forEach((file) => {
            const filen = require(`../../commands/Channel Manager/${file}`);
            const name = `\`${filen.name}\``
            channelManagerCommandsList.push(name);
        });

        const lmaoCommandsList = [];
        readdirSync(`${client.cwd}/commands/lmao`).forEach((file) => {
            const filen = require(`../../commands/lmao/${file}`);
            const name = `\`${filen.name}\``
            lmaoCommandsList.push(name);
        });

        function numbering(array) {
            let list = "";
            array.forEach((command, index) => {
                list += `${index + 1}. ${command}\n`;
            })
            return list;
        }

        const bot = ["bot", "info"]
        const utility = ["util", "utils", "utility"]
        const channelManager = ["channel", "channelmanager", "channel-manager", "channel manager", "cm"]
        const lmao = ["lmao", "adm", "admin"]
        const argument = args.join(" ").toLowerCase();

        switch (true) {
            case bot.includes(argument):
                const embed = new client.discord.EmbedBuilder()
                    .setTitle(`🤖 - Bot Commands List`)
                    .addFields({name: "Bot Commands Available:", value: numbering(botCommandsList), inline: true})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`});
                await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
                break;

            case utility.includes(argument):
                const embed2 = new client.discord.EmbedBuilder()
                    .setTitle(`🛠 - Utility Commands List`)
                    .addFields({name: "Utility Commands Available:", value: numbering(utilityCommandsList), inline: true})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`});
                await message.reply({ embeds: [embed2], allowedMentions: { repliedUser: false } });
                break;

            case channelManager.includes(argument):
                const embed3 = new client.discord.EmbedBuilder()
                    .setTitle(`📂 - Channel Manager Commands List`)
                    .addFields({name: "Channel Manager Commands Available:", value: numbering(channelManagerCommandsList), inline: true})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`});
                await message.reply({ embeds: [embed3], allowedMentions: { repliedUser: false } });
                break;

            case lmao.includes(argument):
                if (message.author.id !== client.config.ownerID) {
                    const errEmbed = new client.discord.EmbedBuilder()
                        .setTitle(`⛔ - Error`)
                        .setDescription(`You don't have permission to use this command!`)
                        .setColor(client.config.embedColor)
                        .setFooter({text: `${client.config.embedFooterText1}`});
                    return message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser: false } });
                } else {
                    const embed4 = new client.discord.EmbedBuilder()
                        .setTitle(`😂 - lmao Commands List`)
                        .addFields({name: "Some (if not all) lmao Commands are only available for owner", value: numbering(lmaoCommandsList), inline: true})
                        .setColor(client.config.embedColor)
                        .setFooter({text: `${client.config.embedFooterText1}`});
                    await message.reply({ embeds: [embed4], allowedMentions: { repliedUser: false } });
                }
                break;

            default:
                const embed5 = new client.discord.EmbedBuilder()
                    .setTitle(`Command List | ${client.user.username}`)
                    .addFields({name: `Command list for \`${args.join(" ")}\` category is not found. Please make sure to input any available category from \`sm help\` command.`, value: "Usage: sm list <category>", inline: true})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`});
                await message.reply({ embeds: [embed5], allowedMentions: { repliedUser: false } });
        }
    }
}