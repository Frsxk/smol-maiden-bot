const { readdirSync } = require("fs");

module.exports = {
    name: "help",
    aliases: ["h", "commands"],
    usage: 'sm help <command>',
    category: "Bot",
    description: "See all of my commands, or get help about a specific command.",
    ownerOnly: false,
    run: async (client, message, args) => {
        if (!args[0]) {

            // Get the commands of a Bot category
            const botCommandsList = [];
            readdirSync(`${client.cwd}/commands/Bot`).forEach((file) => {
                const filen = require(`../../commands/Bot/${file}`);
                const name = `\`${filen.name}\``
                botCommandsList.push(name);
            });

            // Get the commands of a Utility category
            const utilityCommandsList = [];
            readdirSync(`${client.cwd}/commands/Utility`).forEach((file) => {
                const filen = require(`../../commands/Utility/${file}`);
                const name = `\`${filen.name}\``
                utilityCommandsList.push(name);
            });

            // Get the commands of a Channel Manager category
            const channelManagerCommandsList = [];
            readdirSync(`${client.cwd}/commands/Channel Manager`).forEach((file) => {
                const filen = require(`../../commands/Channel Manager/${file}`);
                const name = `\`${filen.name}\``
                channelManagerCommandsList.push(name);
            });

            // Get the commands of a lmao category
            const lmaoCommandsList = [];
            readdirSync(`${client.cwd}/commands/lmao`).forEach((file) => {
                const filen = require(`../../commands/lmao/${file}`);
                const name = `\`${filen.name}\``
                lmaoCommandsList.push(name);
            });

            // No help arguments reply
            const helpEmbed = new client.discord.EmbedBuilder()
                .setTitle(`${client.user.username} Help`)
                .setDescription(` Hello **<@${message.author.id}>**, My name is <@${client.user.id}>. Nice to meet you!  \nYou can use \`sm help <command>\` to see more info about the commands!\nUse </help:953834373445189682> to try my slash commands!\n\n**Total Prefix Commands:** ${client.commands.size - lmaoCommandsList.length}\n**Total Slash Commands:** ${client.slash.size}`)
                .addFields(
                    { name: "🤖 - Bot Commands", value: botCommandsList.map((data) => `${data}`).join(", "), inline: true },
                    { name: "📂 - Channel Manager Commands", value: channelManagerCommandsList.map((data) => `${data}`).join(", "), inline: true },
                    { name: "🛠 - Utility Commands", value: utilityCommandsList.map((data) => `${data}`).join(", "), inline: false })
                .setColor(client.config.embedColor)
                .setFooter({ text: `${client.config.embedFooterText}`, iconURL: `${client.user.displayAvatarURL()}` })
                .setTimestamp();
            message.reply({ embeds: [helpEmbed], allowedMentions: { repliedUser: false }});

        } else {
            const command = client.commands.get(args[0].toLowerCase()) || client.commands.find((c) => c.aliases && c.aliases.includes(args[0].toLowerCase()));

            // This is what it sends when using the command with argument and it does not find the command
            if (!command) {
                message.reply({ content: `There is no command named \`${args[0]}\`. Please use \`sm help\` to see all commands available.`, allowedMentions: { repliedUser: false } });
            } else {

                // This is what it sends when using the command with argument and if it finds the command
                let name = command.name;
                let description = command.description || "No description provided"
                let usage = command.usage ? `\`${command.usage}\`` : "No usage provided"
                let aliases = (command.aliases && command.aliases.length > 0) ? command.aliases.map((data) => `\`${data}\``).join(", ") : "No aliases provided";
                let category = command.category || "No category provided"

                let helpCmdEmbed = new client.discord.EmbedBuilder()
                    .setTitle(`${client.user.username} Help | \`${(name.toLocaleString())}\` Command`)
                    .addFields(
                        { name: "Description", value: `${description}` },
                        { name: "Usage", value: `${usage}` },
                        { name: "Aliases", value: `${aliases}` },
                        { name: 'Category', value: `${category}` })
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText1}` })
                    .setTimestamp();

                message.reply({ embeds: [helpCmdEmbed], allowedMentions: { repliedUser: false } });
            }
        }
    },
};
