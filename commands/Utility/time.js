
module.exports = {
    name: "time",
    usage: "sm time (model) (message)",
    category: "Utility",
    description: "Convert any messages to Epoch time, then giving a copyable formatted time. See available models [here](https://pastebin.com/rJFE9yxq)",
    ownerOnly: false, 
    run: async (client, message, args) => {
        function result(model, time) {
            return `<t:${time}:${model}>`
        }
        
        function sendEmbed(result) {
            const embed = new client.discord.EmbedBuilder()
                .setTitle("🕑 Time Converter")
                .addFields({name: "Result:", value: result}, {name: "Copy:", value: `\`${result}\``})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`})
                .setTimestamp()
            return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } })
        }

        if (!args[0]) {
            const embed = new client.discord.EmbedBuilder()
                .addFields({name: "Failed! :no_entry_sign:", value: "Please give a valid model. See \`sm help time\` for more info."})
                .setColor(client.config.embedColor)
                .setFooter({text: `${client.config.embedFooterText1}`})
                .setTimestamp()
            return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } })
        }

        let time;
        let msg;
        // Getting epoch time!
        if (message.type == client.discord.MessageType.Reply) {
            msg = await message.channel.messages.fetch(message.reference.messageId)
            time = Math.floor(msg.createdTimestamp / 1000)
        } else if (Number(args[1])) {
            msg = await message.channel.messages.fetch(args[1])
            time = Math.floor(msg.createdTimestamp / 1000)
        } else if (args[1].includes('https://')) {
            msg = await message.channel.messages.fetch(args[1].slice(67))
            time = Math.floor(msg.createdTimestamp / 1000)
        } else if (args[1].toLowerCase() == 'now') {
            time = Math.floor(Date.now() / 1000)
        }

        let ans;
        // Doing models and sending messages!!
        if (args[0] == "r") {
            ans = result("R", time)
            sendEmbed(ans)
        } else if (args[0] == "f") {
            ans = result("f", time)
            sendEmbed(ans)
        } else if (args[0] == "F") {
            ans = result("F", time)
            sendEmbed(ans)
        } else if (args[0] == "d") {
            ans = result("d", time)
            sendEmbed(ans)
        } else if (args[0] == "D") {
            ans = result("D", time)
            sendEmbed(ans)
        } else if (args[0] == "t") {
            ans = result("t", time)
            sendEmbed(ans)
        } else if (args[0] == "T") {
            ans = result("T", time)
            sendEmbed(ans)
        }
    }
}
