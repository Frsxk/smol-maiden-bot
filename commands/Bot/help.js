const { readdirSync } = require("fs");

module.exports = {
    name: "help",
    aliases: ["h", "commands"],
    usage: 'sm help <command>',
    category: "Bot",
    description: "See my commands, or get help about a specific command.",
    ownerOnly: false,
    run: async (client, message, args) => {
        if (!args[0]) {
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

            const helpEmbed = new client.discord.EmbedBuilder()
                .setTitle(`${client.user.username} Help`)
                .setDescription(`Hello **<@${message.author.id}>**, I'm <@${client.user.id}>. Nice to meet you!\nUse \`sm help <command>\` for details on a specific command, or </help:953834373445189682> for my slash commands.\n\n**Prefix commands:** ${client.commands.size - lmaoCommandsList.length}\n**Slash commands:** ${client.slash.size}`)
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

            if (!command) {
                message.reply({ content: `I don't have a command called \`${args[0]}\`. Run \`sm help\` to see everything I can do.`, allowedMentions: { repliedUser: false } });
            } else {
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
