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

            // Get the commands of a Bot category
            const botCommandsList = [];
            readdirSync(`${client.cwd}/slashCmds/Bot`).forEach((file) => {
                const filen = require(`${client.cwd}/slashCmds/Bot/${file}`);
                const name = `\`${filen.name}\``;
                botCommandsList.push(name);
            });

            // Get the commands of a Utility category
            const utilityCommandsList = [];
            readdirSync(`${client.cwd}/slashCmds/Utility`).forEach((file) => {
                const filen = require(`${client.cwd}/slashCmds/Utility/${file}`);
                const name = `\`${filen.name}\``;
                utilityCommandsList.push(name);
            });

            // Get the commands of a lmao category
            const lmaoCommandsList = [];
            readdirSync(`${client.cwd}/commands/lmao`).forEach((file) => {
                const filen = require(`../../commands/lmao/${file}`);
                const name = `\`${filen.name}\``
                lmaoCommandsList.push(name);
            });

            // This is what it commands when using the command without arguments
            const helpEmbed = new client.discord.EmbedBuilder()
                .setTitle(`${client.user.username} Slash Help`)
                .setDescription(` Hello **<@${interaction.member.id}>**, I am <@${client.user.id}>.  Nice to meet you! \nYou can use </help:953834373445189682> \`<command>\` to see more info about the slash commands!\n\n**Total Prefix Commands:** ${client.commands.size - lmaoCommandsList.length}\n**Total Slash Commands:** ${client.slash.size}`)
                .addFields(
                    { name: "🤖 - Bot Slash Commands", value: botCommandsList.map((data) => `${data}`).join(", "),inline: true },
                    { name: "🛠 - Utility Slash Commands", value: utilityCommandsList.map((data) => `${data}`).join(", "), inline: true })
                .setColor(client.config.embedColor)
                .setFooter({ text: `${client.config.embedFooterText}`, iconURL: `${client.user.displayAvatarURL()}` })
                .setTimestamp();

            interaction.reply({ embeds: [helpEmbed] });
        } else {
            const command = client.slash.get(commandInt.toLowerCase());

            // This is what it sends when using the command with argument and it does not find the command
            if (!command) {
                interaction.reply({ content: `There is no Slash Command named "${commandInt}"` });
            } else {

                // This is what it sends when using the command with argument and if it finds the command
                let command = client.slash.get(commandInt.toLowerCase());
                let name = command.name;
                let description = command.description || "No descrpition provided"
                let usage = command.usage || "No usage provided"
                let category = command.category || "No category provided!"

                let helpCmdEmbed = new client.discord.EmbedBuilder()
                    .setTitle(`${client.user.username} Help | \`${(name.toLocaleString())}\` Slash Command`)
                    .addFields(
                        { name: "Description", value: `${description}` },
                        { name: "Usage", value: `${usage}` },
                        { name: 'Category', value: `${category}` })
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText2}`})
                    .setTimestamp();

                interaction.reply({ embeds: [helpCmdEmbed] });
            }
        }
    },
};
