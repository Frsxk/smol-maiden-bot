import { ActivityType, Events, MessageFlags } from 'discord.js';
import type { ClientEvents, Interaction, Message } from 'discord.js';
import { handlePersistentComponent } from '../components';
import type { AppContext } from '../commands/types';
import type { GiveawayService } from '../features/giveaways/service';

export interface RuntimeLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export const safeAllowedMentions = { parse: [] as never[], repliedUser: false as const };

export interface ParsedPrefixCommand { readonly name: string; readonly args: readonly string[] }

export function parsePrefixCommand(content: string, prefix: string): ParsedPrefixCommand | null {
    const literal = prefix.trimEnd();
    if (!literal || !content.toLowerCase().startsWith(literal.toLowerCase())) return null;
    const remainder = content.slice(literal.length);
    if (literal.length !== prefix.length && !/^\s/.test(remainder)) return null;
    const words = remainder.trim().split(/\s+/);
    const name = words.shift();
    return name ? { name: name.toLowerCase(), args: words } : null;
}

export async function dispatchMessage(context: AppContext, message: Message): Promise<void> {
    if (message.author.bot || !message.inGuild()) return;
    const { config } = context;
    if (config.blockedChannelIds.includes(message.channelId)) return;
    if (config.blockedUserIds.includes(message.author.id)) {
        await message.reply({ content: "You're banned from using this bot.", allowedMentions: safeAllowedMentions });
        return;
    }
    const botId = context.client.user?.id;
    if (botId && new RegExp(`^<@!?${botId}>(?:\\s|$)`).test(message.content)) {
        await message.reply({
            content: `Hey **${message.author.username}**, my prefix is \`${config.botPrefix}\`.\nRun \`${config.botPrefix}help\` to see what I can do.`,
            allowedMentions: safeAllowedMentions,
        });
        return;
    }
    const parsed = parsePrefixCommand(message.content, config.botPrefix);
    if (!parsed) return;
    const command = context.registry.prefixLookup.get(parsed.name);
    if (!command) return;
    if (command.ownerOnly && message.author.id !== config.ownerID) {
        await message.reply({ content: 'Only the bot owner can use this command.', allowedMentions: safeAllowedMentions });
        return;
    }
    await command.execute(context, message, parsed.args);
}

export interface ErrorReplyTarget {
    readonly deferred: boolean;
    readonly replied: boolean;
    editReply(options: { content: string; allowedMentions: { parse: never[]; repliedUser: false } }): Promise<unknown>;
    followUp(options: { content: string; flags: MessageFlags.Ephemeral; allowedMentions: { parse: never[]; repliedUser: false } }): Promise<unknown>;
    reply(options: { content: string; flags: MessageFlags.Ephemeral; allowedMentions: { parse: never[]; repliedUser: false } }): Promise<unknown>;
}

export async function replyToInteractionError(interaction: ErrorReplyTarget, content = 'Something went wrong. Please try again later.'): Promise<void> {
    const options = { content, allowedMentions: safeAllowedMentions };
    if (interaction.deferred && !interaction.replied) await interaction.editReply(options);
    else if (interaction.replied) await interaction.followUp({ ...options, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
}

export async function dispatchInteraction(context: AppContext, interaction: Interaction, giveaways: GiveawayService | null): Promise<void> {
    if (interaction.isButton()) {
        await handlePersistentComponent(context, interaction, giveaways);
        return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild()) {
        await replyToInteractionError(interaction, 'Use this command in a server.');
        return;
    }
    if (context.config.blockedChannelIds.includes(interaction.channelId ?? '') || context.config.blockedUserIds.includes(interaction.user.id)) {
        await replyToInteractionError(interaction, 'Commands are disabled here or for this account.');
        return;
    }
    const command = context.registry.slashLookup.get(interaction.commandName.toLowerCase());
    if (!command) {
        await replyToInteractionError(interaction, 'This command is no longer available. Ask the bot owner to update deployed commands.');
        return;
    }
    if (command.ownerOnly && interaction.user.id !== context.config.ownerID) {
        await replyToInteractionError(interaction, 'Only the bot owner can use this command.');
        return;
    }
    await command.execute(context, interaction);
}

export interface EventRegistrationOptions {
    readonly giveaways: GiveawayService | null;
    readonly accepting: () => boolean;
    readonly logger: RuntimeLogger;
    readonly reportError: (operation: string, error: unknown) => void;
    readonly ready: () => Promise<void>;
    readonly readyFailed: (error: unknown) => void;
}

export function registerEvents(context: AppContext, options: EventRegistrationOptions): () => void {
    const removers: (() => void)[] = [];
    function listen<K extends keyof ClientEvents>(event: K, handler: (...args: ClientEvents[K]) => void | Promise<void>, once = false): void {
        const listener = (...args: ClientEvents[K]): void => {
            if (!options.accepting()) return;
            const task = Promise.resolve().then(() => handler(...args));
            void context.lifecycle.track(task).catch(error => {
                if (event === Events.ClientReady) options.readyFailed(error);
                options.reportError(String(event), error);
            });
        };
        if (once) context.client.once(event, listener);
        else context.client.on(event, listener);
        removers.push(() => { context.client.off(event, listener); });
    }
    listen(Events.MessageCreate, async message => {
        try { await dispatchMessage(context, message); }
        catch (error) {
            options.reportError('Prefix command', error);
            await message.reply({ content: 'Something went wrong. Please try again later.', allowedMentions: safeAllowedMentions });
        }
    });
    listen(Events.InteractionCreate, async interaction => {
        try { await dispatchInteraction(context, interaction, options.giveaways); }
        catch (error) {
            options.reportError('Interaction', error);
            if (interaction.isRepliable()) await replyToInteractionError(interaction);
        }
    });
    listen(Events.ClientReady, async client => {
        const activities = [
            { type: ActivityType.Playing, name: 'is charisk canon?' },
            { type: ActivityType.Watching, name: "frxskie's mistake" },
            { type: ActivityType.Listening, name: `${context.config.botPrefix}help` },
        ] as const;
        client.user.setPresence({ activities: [activities[0]], status: 'online' });
        const interval = setInterval(() => {
            const activity = activities[Math.floor(Math.random() * activities.length)] ?? activities[0];
            client.user.setActivity(activity);
        }, 5 * 60 * 1000);
        context.lifecycle.registerCleanup(() => { clearInterval(interval); });
        options.logger.info(`Logged in as ${client.user.tag}. Serving ${client.guilds.cache.size} servers and ${client.users.cache.size} cached users.`);
        await options.ready();
    }, true);
    listen(Events.GuildMemberAdd, member => {
        options.logger.info(`${member.user.tag} has joined ${member.guild.name}`);
    });
    listen(Events.Error, error => { options.reportError('Discord client', error); });
    return () => { for (const remove of removers) remove(); };
}
