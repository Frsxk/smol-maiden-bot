import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import type { MessageReplyOptions } from 'discord.js';
import type { BotConfig } from '../../config';
import type { OwnershipStore } from '../../database/ownership-store';
import { applyChannelState, withChannelLock } from './channel-permissions';
import type { ApplyResult, OwnershipDocument, PermissionChannel } from './types';

export interface ManagementMember {
    id: string;
    user: { username: string };
    permissions: { has(permission: bigint): boolean };
}

export interface ManagementInput {
    author: { id: string; username: string };
    channel: PermissionChannel & { type: ChannelType; isThread(): boolean };
    guildId: string;
    guildOwnerId: string;
    botId: string;
    administrator: boolean;
    manageChannels: boolean;
    config: Pick<BotConfig, 'ownerID' | 'embedColor' | 'embedFooterText1'>;
    botPermissions(): Promise<{ has(permission: bigint): boolean } | null>;
    fetchChannel(id: string): Promise<PermissionChannel | null>;
    fetchMember(id: string): Promise<ManagementMember>;
    cachedMembers(): Iterable<ManagementMember>;
    searchMembers(query: string): Promise<Iterable<ManagementMember>>;
    reply(payload: MessageReplyOptions): Promise<void>;
}

export interface ManagementDependencies {
    store: OwnershipStore;
    apply: typeof applyChannelState;
    lock: typeof withChannelLock;
}

export type ManagedCommand = 'claim' | 'lock' | 'unlock' | 'whitelist' | 'blacklist';
export type TargetResult = { id: string; member: ManagementMember | null; error?: never }
    | { id?: string; member?: never; error: 'missing' | 'notmember' | 'notfound' | 'lookupfailed' };

function errorCode(error: unknown): number {
    return typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : NaN;
}

export async function resolveTarget(input: ManagementInput, arg?: string, options: { requireMember?: boolean; knownIds?: readonly string[] } = {}): Promise<TargetResult> {
    if (!arg) return { error: 'missing' };
    const id = /^<@!?(\d{17,20})>$/.exec(arg)?.[1] ?? (/^\d{17,20}$/.test(arg) ? arg : undefined);
    if (id) {
        try {
            const member = await input.fetchMember(id);
            return { id: member.id, member };
        } catch (error: unknown) {
            if (!options.requireMember) return { id, member: null };
            return { id, error: [10007, 10013].includes(errorCode(error)) ? 'notmember' : 'lookupfailed' };
        }
    }
    const lower = arg.toLowerCase();
    const cached = [...input.cachedMembers()].find(member => member.user.username.toLowerCase() === lower);
    if (cached) return { id: cached.id, member: cached };
    try {
        const exact = [...await input.searchMembers(arg)].find(member => member.user.username.toLowerCase() === lower);
        return exact ? { id: exact.id, member: exact } : { error: 'notfound' };
    } catch {
        return { error: 'lookupfailed' };
    }
}

export function describeApplyFailure(result: Exclude<ApplyResult, { ok: true }>): string {
    switch (result.code) {
        case 'DISCORD_UPDATE_FAILED': return 'Discord rejected the permission update. Check that I have Manage Roles in this channel and try again.';
        case 'SAVE_FAILED': return 'Discord was updated but saving the channel state failed. The previous permissions were restored; nothing was saved.';
        case 'SAVE_FAILED_ROLLBACK_FAILED': return "Discord was updated but saving the state failed, and restoring the previous permissions also failed. Recheck this channel's permissions manually.";
        default: return 'The channel state could not be applied because the channel or registry entry is not usable.';
    }
}

const unavailable = 'The channel registry is unavailable right now. Try again in a moment.';

export function createManagement(dependencies: ManagementDependencies) {
    const { store, apply, lock } = dependencies;
    return async function execute(command: ManagedCommand, input: ManagementInput, args: readonly string[]): Promise<void> {
        const reply = async (content: string): Promise<void> => {
            await input.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
        };
        const embed = async (title: string, value: string): Promise<void> => {
            await input.reply({ embeds: [new EmbedBuilder().setTitle(title).setDescription(value).setColor(input.config.embedColor)
                .setFooter({ text: input.config.embedFooterText1 }).setTimestamp()], allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
        };
        await lock(input.channel.id, async () => {
            try {
                if (!store.isReady()) { await reply(unavailable); return; }
                if (command === 'claim') {
                    if (input.channel.isThread()) { await reply('Threads cannot be claimed. Use `sm claim` in a regular text channel.'); return; }
                    if (input.channel.type !== ChannelType.GuildText) { await reply('Only regular text channels can be claimed.'); return; }
                    if (!input.manageChannels) { await reply('You need **Manage Channels** on this channel to claim it.'); return; }
                    let permissions;
                    try { permissions = await input.botPermissions(); } catch { permissions = null; }
                    if (!permissions) { await reply("I couldn't check my permissions in this channel. Try again in a moment."); return; }
                    const required: readonly (readonly [string, bigint])[] = [
                        ['View Channel', PermissionFlagsBits.ViewChannel], ['Send Messages', PermissionFlagsBits.SendMessages], ['Manage Roles', PermissionFlagsBits.ManageRoles],
                    ];
                    const missing = required.filter(([, bit]) => !permissions.has(bit)).map(([name]) => name);
                    if (missing.length) { await reply(`I need ${missing.join(', ')} in this channel before it can be claimed.`); return; }
                    let existing = await store.findByUser(input.author.id);
                    if (existing && existing.channelId !== input.channel.id && existing.guildId === input.guildId) {
                        const channelId = existing.channelId;
                        let channel: PermissionChannel | null;
                        try {
                            channel = await input.fetchChannel(channelId);
                        } catch (error: unknown) {
                            if (errorCode(error) === 10003) channel = null;
                            else { await reply("I couldn't verify your existing channel with Discord. Nothing was changed; try again in a moment."); return; }
                        }
                        if (!channel) { await store.deleteByChannel(channelId); existing = null; }
                    }
                    if (existing) {
                        const where = existing.guildId === input.guildId ? `<#${existing.channelId}>` : 'another server';
                        await embed('Cannot claim channel', `You already own a channel (${where}). Each user can own one channel.`); return;
                    }
                    const owner = await store.findByChannel(input.channel.id);
                    if (owner) { await embed('Cannot claim channel', `This channel is already owned by <@${owner.userId}>.`); return; }
                    try {
                        await store.create({ userId: input.author.id, guildId: input.guildId, channelId: input.channel.id });
                    } catch (error: unknown) {
                        if (errorCode(error) !== 11000) throw error;
                        const pattern = typeof error === 'object' && error !== null
                            ? ('keyPattern' in error ? error.keyPattern : 'keyValue' in error ? error.keyValue : null) : null;
                        const field = typeof pattern === 'object' && pattern !== null ? pattern : {};
                        await embed('Cannot claim channel', 'userId' in field ? 'You already own a channel. Each user can own one channel.'
                            : 'channelId' in field ? 'This channel was just claimed by someone else.' : 'That claim conflicts with an existing channel registration.');
                        return;
                    }
                    await embed('Channel claimed', `<#${input.channel.id}> is now **${input.author.username}'s** channel!\nYou can now use \`sm lock\`, \`sm unlock\`, \`sm whitelist\` and \`sm blacklist\` here.`);
                    return;
                }
                const doc = await store.findByChannel(input.channel.id);
                if (!doc) { await reply('This channel has no owner. Use `sm claim` in your personal channel first!'); return; }
                if (doc.userId !== input.author.id && !input.administrator && input.author.id !== input.config.ownerID) {
                    await reply(`Only the channel owner, a server admin, or the bot owner can ${command === 'lock' || command === 'unlock' ? `${command} this channel.` : `manage this channel's ${command}.`}`); return;
                }
                if (command === 'lock' || command === 'unlock') {
                    const wasLocked = doc.locked;
                    const result = await update(doc, { locked: command === 'lock', whitelist: [...doc.whitelist], blacklist: [...doc.blacklist] });
                    if (!result) return;
                    const visibility = result.state.whitelist.length
                        ? `The channel owner, ${result.state.whitelist.length} whitelisted member(s), and the bot keep access.`
                        : 'The channel owner and bot keep access.';
                    const note = wasLocked
                        ? 'This channel was already locked; permissions were re-applied to match the registry.'
                        : 'Server administrators and the server owner can still see it because Discord grants them access.';
                    const status = wasLocked
                        ? 'Lock removed. Permissions were restored to their previous values; blacklisted members stay blocked.'
                        : 'No lock was recorded. Leftover permission changes were cleared; pre-existing permissions were restored.';
                    await embed(command === 'lock' ? '🔒 Lock - Channel Manager' : '🔓 Unlock - Channel Manager', command === 'lock'
                        ? `Locked <#${input.channel.id}>. ${visibility}\n${note}`
                        : `Unlocked <#${input.channel.id}>. ${status}`);
                    return;
                }
                const action = args[0]?.toLowerCase();
                if (action !== 'add' && action !== 'remove') { await reply(`Usage: \`sm ${command} add/remove [user]\``); return; }
                const list = doc[command];
                if (action === 'remove' && !args[1]) {
                    if (!list.length) await reply(`The ${command} is already empty!`);
                    else await embed(`📋 ${command === 'whitelist' ? 'Whitelist' : 'Blacklist'} - Channel Manager`, list.map((id, index) => `**${index + 1}.** <@${id}> (\`${id}\`)`).join('\n') + `\nUse \`sm ${command} remove <user>\` to remove them.`);
                    return;
                }
                const target = await resolveTarget(input, args[1], { requireMember: action === 'add', knownIds: list });
                if (target.error) {
                    const messages = {
                        missing: `Please mention a user, their ID, or their username! Usage: \`sm ${command} add/remove [user]\``,
                        notmember: `That user must be a current member of this server to be ${command === 'whitelist' ? 'whitelisted' : 'blacklisted'}.`,
                        lookupfailed: "I couldn't check that user's membership with Discord. Try again in a moment.",
                        notfound: `I couldn't find that user.${action === 'remove' ? ' If they left the server, remove them by ID or mention instead.' : ' Try a mention, ID, or exact username.'}`,
                    };
                    await reply(messages[target.error]); return;
                }
                const id = target.id;
                if (command === 'whitelist' && id === doc.userId) { await reply('The channel owner already has access while the channel is locked.'); return; }
                if (command === 'blacklist' && action === 'add') {
                    const protectedUser = id === doc.userId ? 'the channel owner' : id === input.botId ? 'the bot'
                        : id === input.guildOwnerId ? 'the server owner' : target.member?.permissions.has(PermissionFlagsBits.Administrator) ? 'a server administrator'
                            : id === input.author.id ? 'yourself' : null;
                    if (protectedUser) { await reply(`You can't blacklist ${protectedUser}.`); return; }
                }
                if (action === 'add' && command === 'whitelist' && doc.blacklist.includes(id)) { await reply(`<@${id}> is blacklisted. Remove them from the blacklist before whitelisting them.`); return; }
                if (action === 'add' && list.includes(id)) { await reply(`<@${id}> is already ${command === 'whitelist' ? 'whitelisted' : 'blacklisted'}!`); return; }
                if (action === 'remove' && !list.includes(id)) { await reply(`<@${id}> isn't on the ${command}!`); return; }
                const next = { locked: doc.locked, whitelist: [...doc.whitelist], blacklist: [...doc.blacklist] };
                next[command] = action === 'add' ? [...list, id] : list.filter(entry => entry !== id);
                if (command === 'blacklist' && action === 'add') next.whitelist = next.whitelist.filter(entry => entry !== id);
                if (!await update(doc, next)) return;
                await reply(`${action === 'add' ? 'Added' : 'Removed'} <@${id}> ${action === 'add' ? 'to' : 'from'} the ${command}.${command === 'blacklist' ? action === 'add' ? ' They can no longer see this channel.' : ' Their previous view permissions apply again; a locked channel still requires a whitelist exception.' : doc.locked ? action === 'add' ? ' They can see the locked channel now.' : ' They no longer have a whitelist exception. Administrators still bypass channel restrictions.' : ''}`);
            } catch {
                await reply(command === 'claim' ? 'The claim failed because of an unexpected error.' : `I couldn't finish ${command === 'lock' ? 'locking this channel' : command === 'unlock' ? 'unlocking this channel' : `updating the ${command}`}. Check the channel's permissions before trying again.`);
            }
        });
        async function update(doc: OwnershipDocument, state: { locked: boolean; whitelist: string[]; blacklist: string[] }) {
            let fresh;
            try { fresh = await input.fetchChannel(input.channel.id); } catch { fresh = null; }
            if (!fresh) { await reply("I couldn't refresh this channel's permissions from Discord. Nothing was changed; try again."); return null; }
            const result = await apply(fresh, doc, state, input.botId, `Channel Manager: ${command}`);
            if (!result.ok) { await reply(describeApplyFailure(result)); return null; }
            return result;
        }
    };
}
