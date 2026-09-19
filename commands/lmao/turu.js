const rps = require("../../src/rps");

module.exports = {
    name: "turu",
    category: "lmao",
    description: "Just a test command",
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
                title: `RPS request for ${message.mentions.users.first()} !`,
                footer: {text: "Good Luck!"},
                color: client.config.embedColor,
                description: "Rock paper scissor game made using simply-djs",
            },
        })
    }
}
/*
const msg = args[0];
const chnl = client.channels.resolve(msg);
chnl.setParent('954368406839246908')
    .then(message.reply('turu mint :herb:'))
    .catch(console.error);     
*/
