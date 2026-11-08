const { PermissionFlagsBits } = require('discord.js');
const OwnedChannel = require('../models/OwnedChannel');

const MENTION_RE = /^<@!?(\d{17,20})>$/;
const ID_RE = /^\d{17,20}$/;
const UNKNOWN_MEMBER_CODES = new Set([10007, 10013]);

/**
 * Mongoose buffers queries while disconnected, which makes commands hang.
 * Refuse registry queries until the connection is ready.
 */
function isDbReady() {
    const db = OwnedChannel && OwnedChannel.db;
    return Boolean(db && db.readyState === 1);
}

/**
 * Admins (and the bot owner) bypass channel ownership checks.
 */
function isAdmin(message, client) {
    const member = message && message.member;
    const hasAdmin = Boolean(member && member.permissions && typeof member.permissions.has === 'function'
        && member.permissions.has(PermissionFlagsBits.Administrator));
    const ownerId = client && client.config ? client.config.ownerID : undefined;
    return hasAdmin || (ownerId !== undefined && String(message.author.id) === String(ownerId));
}

async function getChannelDoc(channelId) {
    if (!isDbReady()) return null;
    return OwnedChannel.findOne({ channelId: String(channelId) }).exec();
}

async function getUserDoc(userId) {
    if (!isDbReady()) return null;
    return OwnedChannel.findOne({ userId: String(userId) }).exec();
}

/**
 * Fetch the ownership doc for the current channel and verify the
 * caller may manage it (owner, admin, or bot owner).
 *
 * @returns {Promise<{doc?: Object, error?: 'db'|'nochannel'|'notowner'}>}
 */
async function requireOwnership(message, client) {
    if (!isDbReady()) return { error: 'db' };
    const doc = await getChannelDoc(message.channel.id);
    if (!doc) return { error: 'nochannel' };
    if (String(doc.userId) !== String(message.author.id) && !isAdmin(message, client)) {
        return { doc, error: 'notowner' };
    }
    return { doc };
}

/**
 * Resolve a command argument to a target id.
 *
 * Mentions and ids resolve without requiring the member to still be in the
 * guild, so whitelist/blacklist removal keeps working after someone leaves.
 * Username matching uses the exact, case-insensitive user.username (never the
 * display name/nickname) and therefore needs a current guild member.
 *
 * @param {Message} message
 * @param {string} [arg]
 * @param {{requireMember?: boolean, knownIds?: string[]}} [options]
 * @returns {Promise<{id?: string, member?: GuildMember, error?: 'missing'|'notmember'|'notfound'|'lookupfailed'}>}
 */
async function resolveTarget(message, arg, options = {}) {
    if (!arg) return { error: 'missing' };
    const requireMember = Boolean(options.requireMember);
    const knownIds = Array.isArray(options.knownIds) ? options.knownIds.map(String) : [];

    let id = null;
    const mention = String(arg).match(MENTION_RE);
    if (mention) id = mention[1];
    else if (ID_RE.test(String(arg))) id = String(arg);

    if (id) {
        let member = null;
        let lookupFailed = false;
        try {
            member = await message.guild.members.fetch(id);
        } catch (error) {
            const code = error && error.code !== undefined ? Number(error.code) : NaN;
            if (!UNKNOWN_MEMBER_CODES.has(code)) lookupFailed = true;
        }

        if (!member) {
            if (lookupFailed) {
                return requireMember
                    ? { id, error: 'lookupfailed' }
                    : { id, member: null };
            }
            if (requireMember) return { id, error: 'notmember' };
            return { id, member: null };
        }
        return { id: String(member.id ?? id), member };
    }

    const lower = String(arg).toLowerCase();

    const cache = message.guild && message.guild.members && message.guild.members.cache;
    if (cache && typeof cache.find === 'function') {
        const cached = cache.find((member) => member && member.user
            && String(member.user.username).toLowerCase() === lower);
        if (cached) return { id: String(cached.id), member: cached };
    }

    if (!message.guild || !message.guild.members || typeof message.guild.members.fetch !== 'function') {
        if (knownIds.includes(String(arg))) return { id: String(arg), member: null };
        return { error: 'notfound' };
    }

    if (knownIds.includes(String(arg))) return { id: String(arg), member: null };

    let fetched;
    try {
        fetched = await message.guild.members.fetch({ query: String(arg), limit: 1000 });
    } catch (error) {
        if (knownIds.includes(String(arg))) return { id: String(arg), member: null };
        return { error: 'lookupfailed' };
    }

    const values = fetched && typeof fetched.values === 'function'
        ? [...fetched.values()]
        : (Array.isArray(fetched) ? fetched : []);
    const exact = values.find((member) => member && member.user
        && String(member.user.username).toLowerCase() === lower);
    if (exact) return { id: String(exact.id), member: exact };
    return { error: 'notfound' };
}

/**
 * Legacy helper used by older code: resolve a guild member only.
 */
async function resolveTargetMember(message, arg) {
    const result = await resolveTarget(message, arg, { requireMember: true });
    if (result.error) {
        return { error: result.error === 'missing' ? 'missing' : 'notfound' };
    }
    return { member: result.member };
}

function getBotId(client, message) {
    const candidates = [
        client && client.user ? client.user.id : undefined,
        message && message.client && message.client.user ? message.client.user.id : undefined,
        client && client.config ? client.config.botClientID : undefined,
        message && message.guild && message.guild.members && message.guild.members.me
            ? message.guild.members.me.id
            : undefined,
    ];
    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null && String(candidate) !== '') return String(candidate);
    }
    return '';
}

/**
 * Refresh the channel so permissionOverwrites.cache reflects current Discord
 * state. Falls back to the message channel only when the guild object cannot
 * fetch channels at all (test doubles / partial objects).
 */
async function fetchFreshChannel(message) {
    const guild = message.guild;
    const channelId = message.channel && message.channel.id;
    if (!guild || !guild.channels || typeof guild.channels.fetch !== 'function') {
        return { channel: message.channel };
    }
    try {
        const channel = await guild.channels.fetch(channelId, { force: true });
        if (!channel) return { error: new Error('Channel not found') };
        return { channel };
    } catch (error) {
        return { error };
    }
}

/**
 * Check whether a channel still exists. Only a definitive unknown-channel
 * result counts as deleted; network/permission errors are reported as errors.
 */
async function checkChannelPresence(guild, channelId) {
    if (!guild || !guild.channels || typeof guild.channels.fetch !== 'function') return 'unknown';
    try {
        const channel = await guild.channels.fetch(channelId, { force: true });
        return channel ? 'exists' : 'missing';
    } catch (error) {
        const code = error && error.code !== undefined ? Number(error.code) : NaN;
        if (code === 10003) return 'missing';
        return 'error';
    }
}

async function safeReply(message, payload) {
    if (!message || typeof message.reply !== 'function') return null;
    try {
        return await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } });
    } catch (error) {
        return null;
    }
}

/**
 * Human-readable failure text for applyChannelState results.
 */
function describeApplyFailure(result) {
    if (!result) return 'The channel update failed.';
    switch (result.code) {
        case 'DISCORD_UPDATE_FAILED':
            return 'Discord rejected the permission update. Check that I have Manage Roles in this channel and try again.';
        case 'SAVE_FAILED':
            return result.rolledBack
                ? 'Discord was updated but saving the channel state failed. The previous permissions were restored; nothing was saved.'
                : 'Saving the channel state failed.';
        case 'SAVE_FAILED_ROLLBACK_FAILED':
            return 'Discord was updated but saving the state failed, and restoring the previous permissions also failed. Recheck this channel\'s permissions manually.';
        case 'INVALID_CHANNEL':
        case 'INVALID_DOC':
        case 'INVALID_STATE':
            return 'The channel state could not be applied because the channel or registry entry is not usable.';
        default:
            return 'The channel update failed.';
    }
}

module.exports = {
    isDbReady,
    isAdmin,
    getChannelDoc,
    getUserDoc,
    requireOwnership,
    resolveTarget,
    resolveTargetMember,
    getBotId,
    fetchFreshChannel,
    checkChannelPresence,
    safeReply,
    describeApplyFailure,
};
