const { Client, Collection, GatewayIntentBits } = require('discord.js');
const handler = require('./handler/index');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ],
});

client.discord = require('discord.js');
client.slash = new Collection();
client.commands = new Collection();
client.config = require('./config');
client.cwd = process.cwd();

module.exports = client;

async function start() {
    if (!process.env.TOKEN || process.env.TOKEN === 'your-bot-token-here') {
        throw new Error('Set TOKEN in .env before starting the bot.');
    }
    if (client.config.MongoPath) {
        await require('./mongo')();
    } else {
        console.warn('[MongoDB] MONGODB is unset. Channel Manager is disabled.');
    }
    await handler.loadEvents(client);
    await handler.loadCommands(client);
    await handler.loadSlashCommands(client);
    await client.login(process.env.TOKEN);
}

if (require.main === module) {
    process.on('uncaughtException', () => {
        console.error('[Fatal] An uncaught exception stopped the bot.');
        process.exit(1);
    });
    process.on('unhandledRejection', () => {
        console.error('[Fatal] An unhandled rejection stopped the bot.');
        process.exit(1);
    });
    start().catch(async (error) => {
        console.error(`[Startup] ${error.name}: ${error.message}`);
        client.destroy();
        await require('mongoose').disconnect();
        process.exitCode = 1;
    });
}
