const simplydjs = require('simply-djs')

module.exports = {
    name: "test",
    category: "lmao",
    ownerOnly: false,
    description: "test command for smol maiden",
    run: async (client, message, args) => {
        message.reply(`cutie`);

        // const late = await chnl.messages.fetch(args[0]);
        // const latest = late.content;
    }
}