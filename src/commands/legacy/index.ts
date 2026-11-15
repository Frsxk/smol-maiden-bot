import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
    PermissionFlagsBits, type Message,
} from 'discord.js';
import petPetGif from 'pet-pet-gif';
import type { AppContext, PrefixCommand } from '../types';
import { menuRole } from '../../components/roles';
import type { GiveawayService } from '../../features/giveaways/service';
import { playRps } from '../../features/rps';
import { controlPm2, startProcess } from '../../integrations/processes';

const mentions = { parse: [] as never[], repliedUser: false };

async function reply(message: Message<true>, content: string): Promise<void> {
    await message.reply({ content, allowedMentions: mentions });
}

function command(name: string, aliases: readonly string[], ownerOnly: boolean, usage: string, description: string, execute: PrefixCommand['execute']): PrefixCommand {
    return { name, aliases, ownerOnly, usage, category: 'lmao', description, execute };
}

export function parseGiveawayDuration(value: string): number | null {
    const match = /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?|m|minutes?|h|hours?|d|days?|w|weeks?|y|years?)?$/i.exec(value);
    if (!match?.[1]) return null;
    const units: Readonly<Record<string, number>> = {
        ms: 1, millisecond: 1, milliseconds: 1,
        s: 1000, second: 1000, seconds: 1000,
        m: 60_000, minute: 60_000, minutes: 60_000,
        h: 3_600_000, hour: 3_600_000, hours: 3_600_000,
        d: 86_400_000, day: 86_400_000, days: 86_400_000,
        w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
        y: 31_557_600_000, year: 31_557_600_000, years: 31_557_600_000,
    };
    const duration = Number(match[1]) * (units[match[2]?.toLowerCase() ?? 'ms'] ?? 1);
    return Number.isSafeInteger(duration) && duration > 0 && duration <= 8_640_000_000_000_000 - Date.now() ? duration : null;
}

async function createRoleMenus(context: AppContext, message: Message<true>): Promise<void> {
    const menus = context.config.guilds[message.guildId]?.roleMenus;
    if (!menus?.length) {
        await reply(message, 'Role menus are not configured for this server. Nothing was changed.');
        return;
    }
    for (const menu of menus) {
        for (const button of menu.buttons) {
            if (!await menuRole(message.guild, button.roleId)) {
                await reply(message, 'A configured role is missing, privileged, managed, or above the bot. Nothing was posted.');
                return;
            }
        }
    }
    for (const menu of menus) {
        const rows: ActionRowBuilder<ButtonBuilder>[] = [];
        for (let index = 0; index < menu.buttons.length; index += 5) {
            const row = new ActionRowBuilder<ButtonBuilder>();
            for (const item of menu.buttons.slice(index, index + 5)) {
                const button = new ButtonBuilder().setCustomId(`role-${item.roleId}`).setLabel(item.label).setStyle(ButtonStyle[item.style]);
                if (item.emoji) button.setEmoji(item.emoji);
                row.addComponents(button);
            }
            rows.push(row);
        }
        const embed = new EmbedBuilder().setTitle(menu.title).setDescription(menu.description)
            .setColor(context.config.embedColor).setFooter({ text: menu.footerText });
        await message.channel.send({ embeds: [embed], components: rows, allowedMentions: mentions });
    }
}

async function updateRules(context: AppContext, message: Message<true>): Promise<void> {
    const destination = context.config.guilds[message.guildId]?.rulesDestination;
    if (!destination) {
        await reply(message, 'A rules destination is not configured for this server. Nothing was changed.');
        return;
    }
    const channel = await message.guild.channels.fetch(destination.channelId);
    if (!channel?.isTextBased()) {
        await reply(message, 'The configured rules destination is not a server text channel. Nothing was changed.');
        return;
    }
    const target = await channel.messages.fetch(destination.messageId);
    if (target.author.id !== context.client.user?.id || !target.editable) {
        await reply(message, 'The configured rules message is not editable by this bot. Nothing was changed.');
        return;
    }
    const embed = new EmbedBuilder().setTitle("⁎✲ﾟ Loli's Fantasy *｡⋆♡ | Server Rules")
        .addFields({ name: 'Here are the rules for this server!', value: "1. Follow Discord [ToS](https://discord.com/tos) and [Community Guidelines](https://discord.com/guidelines)\n2. Don't be rude. Respect everyone.\n3. No NSFW content outside the NSFW channel. This includes your username, about me, and status.\n4. Don't abuse bugs. Report them by DMing <@!543313602942337035> (@frxskie).\n5. Use common sense." })
        .setDescription('Breaking these rules can get you banned from the server.').setColor(context.config.embedColor)
        .setFooter({ text: 'Last Updated' }).setTimestamp();
    await target.edit({ embeds: [embed], allowedMentions: mentions });
}

async function resetPositions(context: AppContext, message: Message<true>, args: readonly string[]): Promise<void> {
    const group = args[0];
    if (group !== undefined && !['c', 'b', 'a'].includes(group)) {
        await reply(message, 'Choose resetpos c, b, a, or omit the group to reset all channels.');
        return;
    }
    const configured = context.config.guilds[message.guildId]?.resetPositions;
    const positions = configured?.filter(item => (group ? item.group === group : ['c', 'b', 'a'].includes(item.group)));
    if (!positions?.length) {
        await reply(message, 'Channel reset positions are not configured for this server or group. Nothing was changed.');
        return;
    }
    const bot = await message.guild.members.fetchMe();
    if (!bot.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await reply(message, 'I need Manage Channels to reset channel positions. Nothing was changed.');
        return;
    }
    const changes = [];
    for (const position of positions) {
        const [channel, category] = await Promise.all([
            message.guild.channels.fetch(position.channelId), message.guild.channels.fetch(position.categoryId),
        ]);
        if (!channel || channel.isThread() || channel.type === ChannelType.GuildCategory || category?.type !== ChannelType.GuildCategory
            || !channel.manageable || !category.manageable || !channel.permissionsFor(bot).has(PermissionFlagsBits.ManageChannels)) {
            await reply(message, 'A configured channel or category is missing or cannot be managed. Nothing was changed.');
            return;
        }
        changes.push({ channel, category, position: position.position, group: position.group });
    }
    const progress = await message.channel.send({ content: '⚒️ Moving channels...', allowedMentions: mentions });
    for (const currentGroup of ['c', 'b', 'a']) {
        const selected = changes.filter(change => change.group === currentGroup);
        for (const change of selected) await change.channel.setParent(change.category);
        for (const change of selected) await change.channel.setPosition(change.position);
    }
    const embed = new EmbedBuilder().addFields({ name: 'Success! ✅', value: 'All selected test channels have been reset.' })
        .setColor(context.config.embedColor).setFooter({ text: context.config.embedFooterText1 }).setTimestamp();
    await message.reply({ embeds: [embed], allowedMentions: mentions });
    await progress.delete();
}

async function echo(context: AppContext, message: Message<true>, args: readonly string[]): Promise<void> {
    const mode = args[1]?.toLowerCase();
    const embedded = mode !== undefined && ['y', 'ye', 'yes'].includes(mode);
    const plain = mode !== undefined && ['n', 'no'].includes(mode);
    const content = (embedded || plain ? args.slice(2) : args).join(' ');
    if (!content.length || content.length > (embedded ? 4096 : 2000)) {
        await reply(message, 'Provide non-empty text within the Discord message limit.');
        return;
    }
    if (!embedded && !plain) {
        await message.channel.send({ content, allowedMentions: mentions });
        return;
    }
    const channelId = /^<#(\d+)>$/.exec(args[0] ?? '')?.[1] ?? args[0];
    if (!channelId || !/^\d+$/.test(channelId)) {
        await reply(message, 'Provide a valid server channel mention or ID.');
        return;
    }
    const channel = await message.guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) {
        await reply(message, 'The destination must be a sendable text channel in this server.');
        return;
    }
    if (embedded) await channel.send({ embeds: [new EmbedBuilder().setDescription(content).setColor(context.config.embedColor)], allowedMentions: mentions });
    else await channel.send({ content, allowedMentions: mentions });
    await reply(message, 'Done!');
}

async function processControl(context: AppContext, message: Message<true>, action: 'restart' | 'stop'): Promise<void> {
    if (message.author.id !== context.config.ownerID) return;
    if (!context.config.pm2ProcessName) {
        await reply(message, 'PM2 process control is disabled. The operator must use docker compose for Docker deployments, or configure PM2_PROCESS_NAME for PM2.');
        return;
    }
    await reply(message, action === 'restart' ? 'turu? :sleeping:' : 'turu mint :sweat_smile::point_up:');
    try {
        await controlPm2(action, context.config.pm2ProcessName);
    } catch (error) {
        console.error('PM2 operation failed:', error);
        await reply(message, 'The PM2 operation did not complete. Ask the operator to check the console and PM2 installation.');
    }
}

export function createLegacyCommands(giveaways: GiveawayService | null): readonly PrefixCommand[] {
    const commands: PrefixCommand[] = [
        command('2iFTIvcy6', [], true, 'sm 2iFTIvcy6', 'Button role menu for the levelling roles.', createRoleMenus),
        command('6nhEqa0jM3', [], true, 'sm 6nhEqa0jM3', "Update the server rules message in Loli's Fantasy.", updateRules),
        command('gstart', ['ga'], true, 'sm gstart (time) (winners) (prize)', 'Create a giveaway!', async (_context, message, args) => {
            if (!giveaways) {
                await reply(message, 'Giveaways are unavailable. Ask the operator to configure the database.');
                return;
            }
            const durationMs = parseGiveawayDuration(args[0] ?? '');
            const winnerCount = /^\d+$/.test(args[1] ?? '') ? Number(args[1]) : 0;
            const prize = args.slice(2).join(' ');
            if (!durationMs || !Number.isSafeInteger(winnerCount) || winnerCount < 1 || !prize || prize.length > 256) {
                await reply(message, 'Usage: gstart <duration, e.g. 1h> <positive winner count> <prize, up to 256 characters>');
                return;
            }
            try {
                await giveaways.create({ guildId: message.guildId, channelId: message.channelId, durationMs, winnerCount, prize, host: message.author.id });
            } catch (error) {
                console.error('Giveaway creation failed:', error);
                await reply(message, 'The giveaway could not be created. Ask the operator to check the console.');
            }
        }),
        command('patthearifin', ['petthearifin', 'arifin', 'afn'], false, 'sm patthearifin', 'I give headpats.', async (context, message) => {
            const user = await context.client.users.fetch(context.config.petUserId);
            const avatar = user.displayAvatarURL({ forceStatic: true, extension: 'png', size: 4096 });
            const image = new AttachmentBuilder(await petPetGif(avatar), { name: 'petthearifin.gif' });
            await message.reply({ files: [image], allowedMentions: mentions });
        }),
        command('resetpos', ['rp'], true, 'sm resetpos', "Reset the test channel positions in Loli's Fantasy.", resetPositions),
        command('echo', ['repeat'], true, 'sm echo <#channel> <embed (y/n)> <text>', 'I will repeat what you want in a specific channel, master~', echo),
        command('run', ['exec', 'execute'], true, 'sm run <command>', "Start a process in the bot's runtime. Output goes to the bot console.", async (context, message, args) => {
            if (message.author.id !== context.config.ownerID) return;
            const executable = args[0];
            if (!executable) {
                await reply(message, 'Please provide a command to run.');
                return;
            }
            try {
                await startProcess(executable, args.slice(1));
                await reply(message, 'Process started. Check the bot console for the result.');
            } catch (error) {
                console.error('Process start failed:', error);
                await reply(message, "I couldn't start that command. Check the bot console for details.");
            }
        }),
        command('restart', ['rs'], true, 'sm restart', 'Goodbye, and hello 👋', async (context, message) => processControl(context, message, 'restart')),
        command('shutdown', ['sd'], true, 'sm shutdown', 'Goodbye 👋', async (context, message) => processControl(context, message, 'stop')),
        command('test', [], false, 'sm test', 'Development test command.', async (_context, message) => reply(message, 'cutie')),
        command('turu', [], false, 'sm turu @opponent', 'Challenge someone to rock paper scissors.', async (context, message) => {
            await playRps(message, { color: context.config.embedColor, footer: { text: 'Good Luck!' }, registerCleanup: cleanup => context.lifecycle.registerCleanup(cleanup) });
        }),
    ];
    return commands;
}
