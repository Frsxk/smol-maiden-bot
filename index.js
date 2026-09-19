const { Client, Collection, GatewayIntentBits } = require('discord.js');
const handler = require("./handler/index");

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

const Discord = require('discord.js');

// Call .env file to get Token
require('dotenv').config()

// Global Variables
client.discord = Discord;
client.slash = new Collection();
client.commands = new Collection();
client.config = require('./config');
client.cwd = require('process').cwd(); // require('path').resolve(``);

module.exports = client;

// Records commands and events
handler.loadEvents(client);
handler.loadCommands(client);
handler.loadSlashCommands(client);

// Error Handling
process.on("uncaughtException", (err) => {
    console.log("Uncaught Exception: " + err);
});
  
process.on("unhandledRejection", (reason, promise) => {
    console.log("[FATAL] Possibly Unhandled Rejection at:", promise, "reason: ", reason.message);
});

// Connect simply to mongo database
const simplydjs = require("simply-djs");
// simplydjs.connect(process.env.MONGODB);

// Login Discord Bot Token
client.login(process.env.TOKEN);
