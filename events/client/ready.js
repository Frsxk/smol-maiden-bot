const cron = require("node-cron");

module.exports = {
    name: 'clientReady',
    once: true,

    /**
     * @param {Client} client 
     * @param {GuildMember} member
     */
    async execute(client, member) {

        const activity = [{type: client.discord.ActivityType.Playing, name: "is charisk canon?"}, {type: client.discord.ActivityType.Watching, name: "frxskie's mistake"}, {type: client.discord.ActivityType.Listening, name: "sm help"}];
        const random = Math.floor(Math.random() * activity.length);
        
        // Puts an activity
        client.user.setActivity(activity[0]);
        cron.schedule('*/5 * * * *', () => {
            client.user.setActivity(activity[random]);
        })
        client.user.setStatus('online');
        
        // Send a message on the console
        console.log(`Welcome ${client.user.username}'s owner!`);
        console.log(`[LOG] ${client.user.tag} is now online!\n[LOG] Bot is serving in ${client.guilds.cache.size} servers\n[LOG] Bot is serving ${client.users.cache.size} users`);
    }
}
