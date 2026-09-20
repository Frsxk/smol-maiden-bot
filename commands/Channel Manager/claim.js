const OwnedChannel = require('../../models/OwnedChannel');

module.exports = {
    name: "claim",
    aliases: [],
    usage: "sm claim",
    category: "Channel Manager",
    description: "Claim the channel you're in as your personal channel! One per user.",
    ownerOnly: false,
    run: async (client, message, args) => {
        const existingUser = await OwnedChannel.findOne({ userId: message.author.id }).exec();
        if (existingUser) {
            return message.reply({
                embeds: [new client.discord.EmbedBuilder()
                    .addFields({ name: "Failed! :no_entry_sign:", value: `You already own <#${existingUser.channelId}>. One channel per person!` })
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText1}` })
                    .setTimestamp()],
                allowedMentions: { repliedUser: false }
            });
        }

        const existingChannel = await OwnedChannel.findOne({ channelId: message.channel.id }).exec();
        if (existingChannel) {
            return message.reply({
                embeds: [new client.discord.EmbedBuilder()
                    .addFields({ name: "Failed! :no_entry_sign:", value: `This channel is already owned by <@${existingChannel.userId}>.` })
                    .setColor(client.config.embedColor)
                    .setFooter({ text: `${client.config.embedFooterText1}` })
                    .setTimestamp()],
                allowedMentions: { repliedUser: false }
            });
        }

        const botMember = await message.guild.members.fetchMe();
        if (!botMember.permissionsIn(message.channel).has("ManageRoles")) {
            return message.reply({ content: "I need the **Manage Channels/Permissions** permission in this channel to manage it!", allowedMentions: { repliedUser: false } });
        }

        await OwnedChannel.create({
            userId: message.author.id,
            guildId: message.guild.id,
            channelId: message.channel.id,
        });

        const embed = new client.discord.EmbedBuilder()
            .setTitle("🎉 Channel Claimed!")
            .addFields(
                { name: "Success! ✅", value: `<#${message.channel.id}> is now **${message.author.username}'s** channel!\nYou can now use \`sm lock\`, \`sm unlock\`, \`sm whitelist\` and \`sm blacklist\` here.` }
            )
            .setColor(client.config.embedColor)
            .setFooter({ text: `${client.config.embedFooterText1}` })
            .setTimestamp();
        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    }
}
