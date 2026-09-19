const simplydjs = require("simply-djs");

module.exports = {
    name: "gstart",
    aliases: ["ga"],
    usage: "sm gstart (time) (winners) (prize)",
    category: "lmao",
    description: "Create a giveaway!\nPowered by [simply-djs](https://simplyd.js.org)",
    ownerOnly: true,
    run: async (client, message, args) => {
        const prefix = client.config.botPrefix;
        const originalContent = message.content;
        if (message.content.startsWith(prefix)) {
            message.content = message.content.slice(prefix.length);
        }
        await simplydjs.giveaway(message, {
            prize: args.slice(2).join(" "),
            winners: args[1],
            time: args[0],
            channel: message.channel
        });
        message.content = originalContent;
    }
}
