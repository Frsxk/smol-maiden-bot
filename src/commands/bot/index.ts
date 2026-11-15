import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { InteractionEditReplyOptions, InteractionReplyOptions, MessageReplyOptions } from 'discord.js';
import type { AppContext, CommandMetadata, PrefixCommand, SlashCommand } from '../types';

function baseEmbed(context: AppContext, slash = false): EmbedBuilder {
    return new EmbedBuilder().setColor(context.config.embedColor)
        .setFooter({ text: slash ? context.config.embedFooterText2 : context.config.embedFooterText1 });
}

function categoryNames(commands: readonly CommandMetadata[], category: string): string {
    return commands.filter(command => command.category.toLowerCase() === category.toLowerCase())
        .map(command => `\`${command.name}\``).join(', ') || 'No commands available.';
}

function overview(context: AppContext, userId: string, slash: boolean): EmbedBuilder {
    const bot = context.client.user;
    const commands = slash ? context.registry.slash : context.registry.prefix;
    const embed = baseEmbed(context, slash)
        .setTitle(`${bot?.username ?? 'Smol Maiden'} ${slash ? 'Slash Help' : 'Help'}`)
        .setDescription(`Hello **<@${userId}>**, I'm <@${bot?.id ?? context.config.botClientID}>. Nice to meet you!\n${slash ? 'Use `/help <command>` for details on a slash command.' : `Use \`${context.config.botPrefix}help <command>\` for details on a specific command, or \`/help\` for my slash commands.`}\n\n**Prefix commands:** ${context.registry.prefix.filter(command => command.category.toLowerCase() !== 'lmao').length}\n**Slash commands:** ${context.registry.slash.length}`)
        .addFields({ name: `🤖 - Bot ${slash ? 'Slash ' : ''}Commands`, value: categoryNames(commands, 'Bot'), inline: true });
    if (!slash) embed.addFields({ name: '📂 - Channel Manager Commands', value: categoryNames(commands, 'Channel Manager'), inline: true });
    embed.addFields({ name: `🛠 - Utility ${slash ? 'Slash ' : ''}Commands`, value: categoryNames(commands, 'Utility'), inline: slash });
    embed.setFooter(bot ? { text: context.config.embedFooterText, iconURL: bot.displayAvatarURL() } : { text: context.config.embedFooterText });
    return embed.setTimestamp();
}

function details(context: AppContext, command: CommandMetadata, slash: boolean, aliases: readonly string[] = []): EmbedBuilder {
    const embed = baseEmbed(context, slash)
        .setTitle(`${context.client.user?.username ?? 'Smol Maiden'} Help | \`${command.name}\` ${slash ? 'Slash ' : ''}Command`)
        .addFields({ name: 'Description', value: command.description || 'No description provided' }, { name: 'Usage', value: `\`${command.usage}\`` });
    if (!slash) embed.addFields({ name: 'Aliases', value: aliases.length ? aliases.map(alias => `\`${alias}\``).join(', ') : 'No aliases provided' });
    return embed.addFields({ name: 'Category', value: command.category }).setTimestamp();
}

export interface HelpMessage {
    readonly author: { readonly id: string };
    reply(options: MessageReplyOptions): Promise<unknown>;
}

export async function executePrefixHelp(context: AppContext, message: HelpMessage, args: readonly string[]): Promise<void> {
    const name = args[0];
    if (!name) {
        await message.reply({ embeds: [overview(context, message.author.id, false)], allowedMentions: { repliedUser: false } });
        return;
    }
    const command = context.registry.prefixLookup.get(name.toLowerCase());
    if (!command) {
        await message.reply({ content: `I don't have a command called \`${name}\`. Run \`${context.config.botPrefix}help\` to see everything I can do.`, allowedMentions: { parse: [], repliedUser: false } });
        return;
    }
    await message.reply({ embeds: [details(context, command, false, command.aliases)], allowedMentions: { repliedUser: false } });
}

const help: PrefixCommand = {
    name: 'help', aliases: ['h', 'commands'], usage: 'sm help <command>', category: 'Bot',
    description: 'See my commands, or get help about a specific command.', ownerOnly: false,
    execute: executePrefixHelp,
};

const categoryAliases: Readonly<Record<string, string>> = {
    bot: 'Bot', info: 'Bot', util: 'Utility', utils: 'Utility', utility: 'Utility',
    channel: 'Channel Manager', channelmanager: 'Channel Manager', 'channel-manager': 'Channel Manager', 'channel manager': 'Channel Manager', cm: 'Channel Manager',
    lmao: 'lmao', adm: 'lmao', admin: 'lmao',
};

const list: PrefixCommand = {
    name: 'list', aliases: ['cmd', 'ls'], usage: 'sm list <category>', category: 'Bot',
    description: 'Get the list of a command category!', ownerOnly: false,
    async execute(context, message, args): Promise<void> {
        const argument = args.join(' ').toLowerCase();
        const category = Object.hasOwn(categoryAliases, argument) ? categoryAliases[argument] : undefined;
        const embed = baseEmbed(context).setTitle(`Command List | ${context.client.user?.username ?? 'Smol Maiden'}`);
        if (!argument) {
            embed.addFields({ name: 'Which category do you want to see?', value: `Usage: ${context.config.botPrefix}list <category>`, inline: true });
        } else if (!category) {
            embed.setDescription(`I don't know a category called \`${args.join(' ')}\`. Check \`${context.config.botPrefix}help\` for the available categories.`);
        } else if (category === 'lmao' && message.author.id !== context.config.ownerID) {
            embed.setTitle('⛔ - Error').setDescription('Only the bot owner can list these commands.');
        } else {
            const commands = context.registry.prefix.filter(command => command.category.toLowerCase() === category.toLowerCase());
            const icon = category === 'Bot' ? '🤖' : category === 'Utility' ? '🛠' : category === 'lmao' ? '😂' : '📂';
            embed.setTitle(`${icon} - ${category} Commands List`).addFields({
                name: category === 'lmao' ? 'Most of these commands are owner-only' : `${category} Commands Available:`,
                value: commands.map((command, index) => `${index + 1}. \`${command.name}\``).join('\n') || 'No commands available.', inline: true,
            });
        }
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    },
};

const info: PrefixCommand = {
    name: 'info', aliases: ['i', 'information'], usage: 'sm info', category: 'Bot',
    description: 'Some information about me, and my owner!', ownerOnly: false,
    async execute(context, message): Promise<void> {
        const owner = await context.client.users.fetch(context.config.ownerID);
        const member = message.guild.members.cache.get(owner.id);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setLabel('Discord.js').setStyle(ButtonStyle.Link).setURL('https://discord.js.org/'),
            new ButtonBuilder().setLabel('D.js Example').setStyle(ButtonStyle.Link).setURL('https://github.com/Expectatives/Discord.js-v13-Example/'),
            new ButtonBuilder().setLabel('Support Server').setStyle(ButtonStyle.Link).setURL('https://discord.com/invite/2SatpX28ZX'),
        );
        const name = message.author.discriminator === '0' ? message.author.username : message.author.tag;
        const bot = context.client.user;
        const embed = baseEmbed(context).setTitle(`About ${bot?.username ?? 'Smol Maiden'}`)
            .addFields({ name: `Hello there, ${name}`, value: `Smol Maiden is made by **@${owner.username}** with Discord.js and a few Node modules. She's based on the Discord.js-v13-Example template by Expectatives, with help from friends and plenty of tutorials.`, inline: true })
            .setThumbnail((member ?? owner).displayAvatarURL({ size: 4096 })).setTimestamp()
            .setFooter(bot ? { text: context.config.embedFooterText, iconURL: bot.displayAvatarURL() } : { text: context.config.embedFooterText });
        await message.reply({ embeds: [embed], components: [row], allowedMentions: { repliedUser: false } });
    },
};

function pingEmbed(context: AppContext, latency: number, slash: boolean): EmbedBuilder {
    return baseEmbed(context, slash).setTitle(`:signal_strength: ${context.client.user?.username ?? 'Smol Maiden'} Ping`)
        .addFields({ name: 'Time', value: `${Math.floor(latency)}ms`, inline: true }, { name: 'API Ping', value: `${context.client.ws.ping}ms`, inline: true }).setTimestamp();
}

const ping: PrefixCommand = {
    name: 'ping', aliases: ['pong', 'latency'], usage: 'sm ping', category: 'Bot', description: "Check the bot's ping!", ownerOnly: false,
    async execute(context, message): Promise<void> {
        const response = await message.reply({ content: '🏓 Pinging...', allowedMentions: { repliedUser: false } });
        await response.edit({ content: null, embeds: [pingEmbed(context, response.createdTimestamp - message.createdTimestamp, false)] });
    },
};

export interface HelpInteraction {
    readonly user: { readonly id: string };
    readonly options: { getString(name: string): string | null };
    reply(options: InteractionReplyOptions): Promise<unknown>;
}

export async function executeSlashHelp(context: AppContext, interaction: HelpInteraction): Promise<void> {
    const name = interaction.options.getString('command');
    if (!name) {
        await interaction.reply({ embeds: [overview(context, interaction.user.id, true)] });
        return;
    }
    const command = context.registry.slashLookup.get(name.toLowerCase());
    if (!command) {
        await interaction.reply({ content: `I don't have a slash command called "${name}".`, allowedMentions: { parse: [] } });
        return;
    }
    await interaction.reply({ embeds: [details(context, command, true)] });
}

const slashHelp: SlashCommand = {
    name: 'help', usage: '/help <command>', category: 'Bot', description: 'See all of my slash commands, or get help about a specific command.', ownerOnly: false,
    data: new SlashCommandBuilder().setName('help').setDescription('See all of my slash commands, or get help about a specific command.')
        .addStringOption(option => option.setName('command').setDescription('Which command do you want to know about?').setRequired(false)),
    execute: executeSlashHelp,
};

export interface PingInteraction {
    readonly createdTimestamp: number;
    reply(options: InteractionReplyOptions): Promise<unknown>;
    fetchReply(): Promise<{ readonly createdTimestamp: number }>;
    editReply(options: InteractionEditReplyOptions): Promise<unknown>;
}

export async function executeSlashPing(context: AppContext, interaction: PingInteraction): Promise<void> {
    await interaction.reply({ content: '🏓 Pinging...' });
    const response = await interaction.fetchReply();
    await interaction.editReply({ content: null, embeds: [pingEmbed(context, response.createdTimestamp - interaction.createdTimestamp, true)] });
}

const slashPing: SlashCommand = {
    name: 'ping', usage: '/ping', category: 'Bot', description: "Check the bot's ping!", ownerOnly: false,
    data: new SlashCommandBuilder().setName('ping').setDescription("Check the bot's ping!"),
    execute: executeSlashPing,
};

export const prefixCommands: readonly PrefixCommand[] = [help, info, list, ping];
export const slashCommands: readonly SlashCommand[] = [slashHelp, slashPing];
