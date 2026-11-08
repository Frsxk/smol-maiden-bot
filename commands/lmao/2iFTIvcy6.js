const simplydjs = require("simply-djs");

module.exports = {
    name: "2iFTIvcy6",
    usage: "sm 2iFTIvcy6",
    category: "lmao",
    description: "Button role menu for the levelling roles.\nMade with [simply-djs](https://simplyd.js.org).",
    ownerOnly: true,
    run: async (client, message, args) => {
        const lvl1 = message.guild.roles.cache.find(role => role.name === "level 1");
        const lvl2 = message.guild.roles.cache.find(role => role.name === "level 2");
        const lvl3 = message.guild.roles.cache.find(role => role.name === "level 3");

        const embed = new client.discord.EmbedBuilder()
            .setTitle("Get your levelling role here!")
            .setDescription("Click a button below to get that role.")
            .addFields(
                { name: "level 1", value: "Required to move a channel from **category3** to **category2**" },
                { name: "level 2", value: "Required to move a channel from **category2** to **category1**" },
                { name: "level 3", value: "Required to move a channel from **category1** to **category top**" }
            )
            .setColor(client.config.embedColor)
            .setFooter({text: "This only works while I'm online!"});

        simplydjs.btnRole(message, {
            data: [
                {
                    role: "954370385334399027",
                    label: "level 1",
                    style: "SECONDARY", 
                    emoji: "<:_1_:970602352006545450>"
                },
                {
                    role: "954370499050364939",
                    label: "level 2",
                    style: "SECONDARY", 
                    emoji: "<:_2_:970602352010747914>"
                },
                {
                    role: "954370530969022494",
                    label: "level 3",
                    style: "SECONDARY", 
                    emoji: "<:_3_:970602351868129291>"
                }
            ],
            embed: embed,
        });
    }
}
