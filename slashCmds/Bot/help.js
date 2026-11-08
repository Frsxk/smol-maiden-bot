const { readdirSync } = require("fs");
const { ApplicationCommandOptionType } = require('discord.js');

module.exports = {
    name: "help",
    usage: '</help:953834373445189682> \`<command>\`',
    options: [
        {
            name: 'command',
            description: 'Which command do you want to know about?',
            type: ApplicationCommandOptionType.String,
            required: false
        }
    ],
    category: "Bot",
    description: "See all of my slash commands, or get help about a specific command.",
    ownerOnly: false,
    run: async (client, interaction) => {

        const commandInt = interaction.options.getString("command");
        if (!commandInt) {
            const botCommandsList = [];
            readdirSync(`${client.cwd}/slashCmds/Bot`).forEach((file) => {
                const filen = require(`${client.cwd}/slashCmds/Bot/${file}`);
                const name = `\`${filen.name}\``;
                botCommandsList.push(name);
            });

            const utilityCommandsList = [];
            readdirSync(`${client.cwd}/slashCmds/Utility`).forEach((file) => {
                const filen = require(`${client.cwd}/slashCmds/Utility/${file}`);
                const name = `\`${filen.name}\``;
                utilityCommandsList.push(name);
            });

            const lmaoCommandsList = [];
            readdirSync(`${client.cwd}/commands/lmao`).forEach((file) => {
                const filen = require(`../../commands/lmao/${file}`);
                const name = `\`${filen.name}\``
                lmaoCommandsList.push(name);
            });

            const helpEmbed = new client.discord.EmbedBuilder()
                .setTitle(`${client.user.username} Slash Help`)
                .setDescription(`Hello **<@${interaction.member.id}>**, I'm <@${client.user.id}>. Nice to meet you!\nUse </help:953834373445189682> \`<command>\` for details on a slash command.\n\n**Prefix commands:** ${client.commands.size - lmaoCommandsList.length}\n**Slash commands:** ${client.slash.size}`)
                .addFields(
                    { name: "🤖 - Bot Slash Commands", value: botCommandsList.map((data) => `${data}`).join(", "),inline: true },
                    { name: "🛠 - Utility Slash Commands", value: utilityCommandsList.map((data) => `${data}`).join(", "), inline: true })
                .setColor(client.config.embedColor)
                .setFooter({ text: `${client.config.embedFooterText}`, iconURL: `${client.user.displayAvatarURL()}` })
                .setTimestamp();

            interaction.reply({ embeds: [helpEmbed] });
        } else {
            const command = client.slash.get(commandInt.toLowerCase());

            if (!command) {
                interaction.reply({ content: `I don't have a slash command called "${commandInt}".` });
            } else {
                let command = client.slash.get(commandInt.toLowerCase());
                let name = command.name;
                let description = command.description || "No description provided"
                let usage = command.usage || "No usage provided"
                let category = command.category || "No category provided"

                let helpCmdEmbed = new client.discord.EmbedBuilder()
                    .setTitle(`${client.user.username} Help | \`${(name.toLocaleString())}\` Slash Command`)
                    .addFields(
                        { name: "Description", value: `${description}` },
                        { name: "Usage", value: `${usage}` },
                        { name: 'Category', value: `${category}` })
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText2}` })
                    .setTimestamp();

                interaction.reply({ embeds: [helpCmdEmbed] });
            }
        }
    },
};
