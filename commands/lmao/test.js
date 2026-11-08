const simplydjs = require('simply-djs')

module.exports = {
    name: "test",
    category: "lmao",
    ownerOnly: false,
    description: "Development test command.",
    run: async (client, message, args) => {
        message.reply(`cutie`);
    }
}
