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
                .addFields({name: "Which category do you want to see?", value: "Usage: sm list <category>", inline: true})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`});
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        }

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
                        .setDescription(`Only the bot owner can list these commands.`)
                        .setColor(client.config.embedColor)
                        .setFooter({text: `${client.config.embedFooterText1}`});
                    return message.reply({ embeds: [errEmbed], allowedMentions: { repliedUser: false } });
                } else {
                    const embed4 = new client.discord.EmbedBuilder()
                        .setTitle(`😂 - lmao Commands List`)
                        .addFields({name: "Most of these commands are owner-only", value: numbering(lmaoCommandsList), inline: true})
                        .setColor(client.config.embedColor)
                        .setFooter({text: `${client.config.embedFooterText1}`});
                    await message.reply({ embeds: [embed4], allowedMentions: { repliedUser: false } });
                }
                break;

            default:
                const embed5 = new client.discord.EmbedBuilder()
                    .setTitle(`Command List | ${client.user.username}`)
                    .addFields({name: `I don't know a category called \`${args.join(" ")}\`. Check \`sm help\` for the available categories.`, value: "Usage: sm list <category>", inline: true})
                    .setColor(client.config.embedColor)
                    .setFooter({text: `${client.config.embedFooterText1}`});
                await message.reply({ embeds: [embed5], allowedMentions: { repliedUser: false } });
        }
    }
}
