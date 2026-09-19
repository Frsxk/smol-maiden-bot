const { writeFile, writeFileSync } = require('fs');
const petPetGif  = require('pet-pet-gif');

module.exports = {
    name: "patthearifin",
    aliases: ["petthearifin", "arifin", "afn"],
    usage: "sm patthearifin",
    category: "lmao",
    ownerOnly: false,
    description: "i give headpats",
    run: async (client, message, args) => {
        let afn = await client.users.fetch("445158576281878539");
        let pfp = afn.displayAvatarURL({forceStatic: true, extension: "png", size: 4096});
        let animatedGif = await petPetGif(pfp);
        const image = new client.discord.AttachmentBuilder(animatedGif, { name: "petthearifin.gif" })
        // const embed = new client.discord.EmbedBuilder()
        //     .setImage(image) // https://cdn.upload.systems/uploads/xZpU5P9v.gif
        //     .setColor(client.config.embedColor)
        // await message.reply({embeds: [embed], allowedMentions: { repliedUser: false }});
        await message.reply({files: [image], allowedMentions: { repliedUser: false}});
    }
}
