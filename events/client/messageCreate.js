module.exports = {
    name: 'messageCreate',

    /**
     * @param {Message} message 
     * @param {Client} client 
     */
    async execute(message, client) {
        // Channels where the bot should stay quiet
        const blockedChannels = ['674556658248187926', '954368773090082846', '954368755872464926', '956890086845317122'];
        if (blockedChannels.includes(message.channel.id)) return;

        const blockedUsers = ['12345678909876543456'];
        if (blockedUsers.includes(message.author.id)) {
            return message.reply({ content: `<@!${message.author.id}>, you're banned from using this bot.`, allowedMentions: {repliedUser: true} });
        }
        
        if (message.content.startsWith(`<@${client.user.id}>`) || message.content.startsWith(`<@!${client.user.id}>`)) {
            return message.reply({content: `Hey **${message.author.username}**, my prefix is \`sm \`.\nRun \`sm help\` to see what I can do.`, allowedMentions: { repliedUser: false} });
        }

        if (message.author.bot || !message.guild || !message.content.toLowerCase().startsWith(client.config.botPrefix)) return;
        const [cmd, ...args] = message.content.slice(client.config.botPrefix.length).trim().split(" ");
        const command = client.commands.get(cmd.toLowerCase()) || client.commands.find(c => c.aliases?.includes(cmd.toLowerCase()));

        if (!command) return;

        if (command.ownerOnly) {
            if (message.author.id !== client.config.ownerID) {
                return message.reply({ content: "Only the bot owner can use this command.", allowedMentions: { repliedUser: false } });
            }
        }
        
        await command.run(client, message, args);
    }
}
