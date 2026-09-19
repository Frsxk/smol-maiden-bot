const math = require('mathjs')
const { ApplicationCommandOptionType } = require('discord.js');

module.exports = {
    name: "calc",
    category: "Utility",
    usage: "</calc:1040813237568012348> \`<expression>\`",
    description: `Do you even go to school? 🤔`,
    ownerOnly: false,
    options: [
        {
            name: "expression",
            description: "Put your math expression here",
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    run: async (client, interaction) => {

        let express = [];
        const exp = interaction.options.getString("expression");
        express.push(exp)
        let result;

        try {
            result = math.evaluate(exp.replace(/[x]/gi, "*").replace(/[,]/g, ".").replace(/[÷]/gi, "/"));
        } catch (e) {
            interaction.reply({ content: "Please enter a Valid Calculation!\n\nExample of Calculations:\n1. sqrt equation - `sqrt(3^2 + 4^2) = 5`\n2. Units to Units - `2 inch to cm = 0.58`\n3. Complex Expressions Like - `cos(45 deg) = 0.7071067811865476`\n4. Basic Maths Expressions (`+`, `-`, `^`, `/`, decimals) - `2.5-2 = 0.5`" });
            return console.log(e);
        }

        const calcEmbed = new client.discord.EmbedBuilder()
            .setColor(client.config.embedColor)
            .addFields(
               { name: "Operation:", value: `\`\`\`Js\n${exp.replace(/[x]/gi, "*").replace(/[,]/g, ".").replace(/[÷]/gi, "/")}\`\`\``, inline: true }, 
               { name: "Result:", value: `\`\`\`Js\n${result}\`\`\`` })
            .setFooter({ text: `${client.config.embedFooterText2}` })
            .setTimestamp();
        await interaction.reply({ embeds: [calcEmbed] });
    }
}
