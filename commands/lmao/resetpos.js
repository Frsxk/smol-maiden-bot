const wait = require('wait');

module.exports = {
    name: "resetpos",
    aliases: ["rp"],
    usage: "sm resetpos",
    category: "lmao",
    description: "Resets every test channel position for server \"Loli's Fantasy\"",
    ownerOnly: true,
    run: async (client, message, args) => {
        const cParent = message.guild.channels.cache.find(channel => channel.id === '954368431329787924');
        const bParent = message.guild.channels.cache.find(channel => channel.id === '954368406839246908');
        const aParent = message.guild.channels.cache.find(channel => channel.id === '954368368037740564');
        const c1 = message.guild.channels.cache.find(channel => channel.id === '954368755872464926');
        const c2 = message.guild.channels.cache.find(channel => channel.id === '954368773090082846');
        const c3 = message.guild.channels.cache.find(channel => channel.id === '975759659526914058');
        const b1 = message.guild.channels.cache.find(channel => channel.id === '954368703351361557');
        const b2 = message.guild.channels.cache.find(channel => channel.id === '954368725207892119');
        const b3 = message.guild.channels.cache.find(channel => channel.id === '975759702292037734');
        const a1 = message.guild.channels.cache.find(channel => channel.id === '954368620996206592');
        const a2 = message.guild.channels.cache.find(channel => channel.id === '954368678865035284');
        const a3 = message.guild.channels.cache.find(channel => channel.id === '975759732474249286');

        if (message.guild.id == "835368931300474911") {
            const msg = await message.channel.send("⚒️ Moving channels...");

            if ((args[0] == "c") || !args[0]) {
                await c1.setParent(cParent);
                await c2.setParent(cParent);
                await c3.setParent(cParent);
                await wait(100);
                await c1.setPosition(0);
                await c2.setPosition(1);
                await c3.setPosition(2);
            }

            await wait(100);
            msg.edit("⚒️ Moving channels...\n💫 This may took a while because I am getting rate limited.")

            if ((args[0] == "b") || !args[0]) {
                await b1.setParent(bParent);
                await b2.setParent(bParent);
                await b3.setParent(bParent);
                await wait(100);
                await b1.setPosition(0);
                await b2.setPosition(1);
                await b3.setPosition(2);
            }

            await wait(100);
            msg.edit("⚒️ Moving channels...\n💫 This may took a while because I am getting rate limited.\n✨ Almost done!")

            if ((args[0] == "a") || !args[0]) {
                await a1.setParent(aParent);
                await a2.setParent(aParent);
                await a3.setParent(aParent);
                await wait(100);
                await a1.setPosition(0);
                await a2.setPosition(1);
                await a3.setPosition(2);
            }

            const embed = new client.discord.EmbedBuilder()
                .addFields({name: "Success! ✅", value: "All test channels has been resetted."})
                .setColor(client.config.embedColor)
                .setFooter({ text: `${client.config.embedFooterText1}`})
                .setTimestamp();
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });

            msg.delete();
        } else {
            return message.channel.send("invalid server detected. Aborting.");
        }
    }
}