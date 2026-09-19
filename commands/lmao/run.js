const wait = require('wait');
const { spawn } = require("child_process");

module.exports = {
    name: "run",
    aliases: ["exec", "execute"],
    usage: "sm run <command>",
    category: "lmao",
    description: "Run a command in the console",
    ownerOnly: true,
    run: async (client, message, args) => {
        if (!args.length) return message.reply("Please provide a command to run.");
        try {
            await wait(50);
            const child = spawn(args[0], args.slice(1));

            child.stdout.on('data', (data) => {
                console.log(data.toString());
            });

            child.stderr.on('data', (data) => {
                console.error(data.toString());
            });

            child.on('error', (err) => {
                console.error(err);
            });

            await wait(500);
            message.channel.send("Successfully executed.");
        } catch (err) {
            const array = ["lmao", "😴", "😪", "owo7", "xd", "sleep?"];
            const random = Math.floor(Math.random() * array.length);
            const errEmbed = new client.discord.EmbedBuilder()
                .setDescription(`\`\`\`${err}\`\`\``)
                .setColor(client.config.embedColor)
                .setFooter({ text: `${array[random]}`})
                .setTimestamp();
            return message.reply({content: "An error occurred when trying to execute command.", embeds: [errEmbed], allowedMentions: { repliedUser: false } });
        }
    }
}