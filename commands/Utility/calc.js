const math = require('mathjs');

module.exports = {
    name: "calc",
    aliases: ["calculate", "c"],
    usage: 'sm calc <expression>',
    category: "Utility",
    description: `Do you even go to school? :thinking:\nCalculator command is made using [mathjs](https://mathjs.org) package. Click [here](https://mathjs.org/examples/index.html) for command examples!`,
    ownerOnly: false,
    run: async (client, message, args) => {
        
        if (!args[0]) return message.channel.send("Please enter an expression!\nSee `sm help calc` for examples of this command.");

        let result;
        try {
            result = math.evaluate(args.join("").replace(/[x]/gi, "*").replace(/[,]/g, ".").replace(/[÷]/gi, "/"));
        } catch (e) {
            message.channel.send("Please enter a Valid Calculation!\n\nExample of Calculations:\n1. sqrt equation - `sqrt(3^2 + 4^2) = 5`\n2. Units to Units - `2 inch to cm = 0.58`\n3. Complex Expressions Like - `cos(45 deg) = 0.7071067811865476`\n4. Basic Maths Expressions (`+`, `-`, `^`, `/`, decimals) - `2.5-2 = 0.5`");
            return console.log(e)
        }

        const embed = new client.discord.EmbedBuilder()
            .setColor(client.config.embedColor)
            .addFields(
                { name: "Operation:", value: `\`\`\`Js\n${args.join(" ").replace(/[x]/gi, "*").replace(/[,]/g, ".").replace(/[÷]/gi, "/")}\`\`\`` },
                { name: "Result:", value: `\`\`\`Js\n${result}\`\`\`` })
            .setFooter({ text: `${client.config.embedFooterText1}` })
            .setTimestamp();
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser : false } });
    }
}
