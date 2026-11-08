const math = require('mathjs');

module.exports = {
    name: "calc",
    aliases: ["calculate", "c"],
    usage: 'sm calc <expression>',
    category: "Utility",
    description: `Crunch numbers with [mathjs](https://mathjs.org). See [the examples](https://mathjs.org/examples/index.html) for syntax.`,
    ownerOnly: false,
    run: async (client, message, args) => {
        
        if (!args[0]) return message.channel.send("Give me an expression to calculate.\nSee `sm help calc` for examples.");

        let result;
        try {
            result = math.evaluate(args.join("").replace(/[x]/gi, "*").replace(/[,]/g, ".").replace(/[÷]/gi, "/"));
        } catch (e) {
            message.channel.send("That expression didn't work. Try something like:\n1. Square roots: `sqrt(3^2 + 4^2) = 5`\n2. Unit conversion: `2 inch to cm`\n3. Functions: `cos(45 deg) = 0.7071067811865476`\n4. Arithmetic (`+`, `-`, `^`, `/`, decimals): `2.5-2 = 0.5`");
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
