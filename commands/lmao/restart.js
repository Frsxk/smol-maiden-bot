let { exec: execS } = require("child_process")

module.exports = {
    name: "restart",
    aliases: ["rs"],
    usage: "sm restart",
    category: "lmao",
    description: "Goodbye, and hello 👋",
    ownerOnly: true,
    run: async (client, message, args) => {
        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        };
        message.channel.send("turu? :sleeping:");
        sleep(500);
        execS(`pm2 restart index.js`, async (err, stdout) => {
            if (err) return console.log(err)
            if (stdout) return console.log(stdout)
        });

    }
}