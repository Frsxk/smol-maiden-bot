
module.exports = {
    name: "echo",
    aliases: ["repeat"],
    usage: "sm echo <#channel> <embed (y/n)> <text>",
    category: "lmao",
    description: "I will repeat what you want in a specific channel, master~",
    ownerOnly: true,
    run: async (client, message, args) => {
        // constants!
        const chnl = message.mentions.channels.first() || await client.channels.fetch(args[0]).catch(() => null)
        const yesAns = ["y", "ye", "yes"];
        const noAns = ["n", "no"];
        const ans = args[1];
        const txt = args.slice(2).join(" ");

        try {
            if (noAns.includes(ans)) {
                chnl.send(txt);
            } else if (yesAns.includes(ans)) {
                const embed = new client.discord.EmbedBuilder()
                    .setDescription(txt)
                    .setColor(client.config.embedColor)
                chnl.send({ embeds: [embed] });
            } else {
                let textt = args.join(" ");
                return message.channel.send(textt);
            }
            await message.channel.send("Done!")
        } catch (error) {
            await message.channel.send("Unknown error occurred.")
            return console.log(error)
        }
    }
}