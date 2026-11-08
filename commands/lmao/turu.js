const rps = require("../../src/rps");

module.exports = {
    name: "turu",
    category: "lmao",
    description: "Challenge someone to rock paper scissors.",
    ownerOnly: false,
    run: async (client, message, interaction, args) => {
        function turu(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        };
        rps(message, client, interaction, {
            embed: {
                credit: false,
                author: {
                    name: message.author.tag,
                    iconURL: message.author.displayAvatarURL(),
                },
                title: `Rock paper scissors request for ${message.mentions.users.first()}!`,
                footer: {text: "Good Luck!"},
                color: client.config.embedColor,
                description: "Rock paper scissors, powered by simply-djs.",
            },
        })
    }
}
