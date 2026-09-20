const { PermissionFlagsBits } = require('discord.js');
const OwnedChannel = require('../models/OwnedChannel');

const MENTION_RE = /^<@!?(\d{17,20})>$/;
const ID_RE = /^\d{17,20}$/;

/**
 * Resolve a command argument to a guild member by mention, user ID,
 * or username (unique per user since the discriminator removal).
 * Display names are NOT matched — they are not unique.
 *
 * @param {Message} message
 * @param {string} [arg]
 * @returns {Promise<{member?: GuildMember, error?: 'missing'|'notfound'}>}
 */
async function resolveTargetMember(message, arg) {
    if (!arg) return { error: 'missing' };

    const mention = arg.match(MENTION_RE);
    if (mention) {
        const member = await message.guild.members.fetch(mention[1]).catch(() => null);
        return member ? { member } : { error: 'notfound' };
    }

    if (ID_RE.test(arg)) {
        const member = await message.guild.members.fetch(arg).catch(() => null);
        return member ? { member } : { error: 'notfound' };
    }

    // Username match (case-insensitive) — unique, so one hit or none
    const lower = arg.toLowerCase();
    const cached = message.guild.members.cache.find((m) => m.user.username.toLowerCase() === lower);
    if (cached) return { member: cached };

    // Cache miss — ask the API (prefix query), then filter to exact username
    const fetched = await message.guild.members.fetch({ query: arg, limit: 10 }).catch(() => null);
    if (fetched) {
        const exact = fetched.find((m) => m.user.username.toLowerCase() === lower);
        if (exact) return { member: exact };
    }

    return { error: 'notfound' };
}

/**
 * Admins (and the bot owner) bypass channel ownership checks.
 */
function isAdmin(message, client) {
    return message.member.permissions.has(PermissionFlagsBits.Administrator)
        || message.author.id === client.config.ownerID;
}

async function getChannelDoc(channelId) {
    return OwnedChannel.findOne({ channelId }).exec();
}

async function getUserDoc(userId) {
    return OwnedChannel.findOne({ userId }).exec();
}

/**
 * Fetch the ownership doc for the current channel and verify the
 * caller may manage it (owner, admin, or bot owner).
 *
 * @returns {Promise<{doc?: Object, error?: 'nochannel'|'notowner'}>}
 */
async function requireOwnership(message, client) {
    const doc = await getChannelDoc(message.channel.id);
    if (!doc) return { error: 'nochannel' };
    if (doc.userId !== message.author.id && !isAdmin(message, client)) {
        return { doc, error: 'notowner' };
    }
    return { doc };
}

module.exports = { resolveTargetMember, isAdmin, getChannelDoc, getUserDoc, requireOwnership };
