import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, DiscordAPIError,
    EmbedBuilder, SlashCommandBuilder, type ButtonInteraction, type GuildMember, type User,
} from 'discord.js';
import type { AppContext, PrefixCommand, SlashCommand } from '../types';
import { calculate, CalculatorInputError, calculatorExamples, type Calculation } from './calculator';

function baseEmbed(context: AppContext, slash = false): EmbedBuilder {
    return new EmbedBuilder().setColor(context.config.embedColor)
        .setFooter({ text: slash ? context.config.embedFooterText2 : context.config.embedFooterText1 }).setTimestamp();
}

function calculationEmbed(context: AppContext, calculation: Calculation, slash: boolean): EmbedBuilder {
    return baseEmbed(context, slash).addFields(
        { name: 'Operation:', value: `\`\`\`Js\n${calculation.operation}\`\`\``, inline: slash },
        { name: 'Result:', value: `\`\`\`Js\n${calculation.result}\`\`\`` },
    );
}

const calc: PrefixCommand = {
    name: 'calc', aliases: ['calculate', 'c'], usage: 'sm calc <expression>', category: 'Utility',
    description: 'Crunch numbers with [mathjs](https://mathjs.org). See [the examples](https://mathjs.org/examples/index.html) for syntax.', ownerOnly: false,
    async execute(context, message, args): Promise<void> {
        if (!args.length) {
            await message.reply({ content: `Give me an expression to calculate.\nSee \`${context.config.botPrefix} help calc\` for examples.`, allowedMentions: { repliedUser: false } });
            return;
        }
        let calculation: Calculation;
        try {
            calculation = await calculate(args.join(' '));
        } catch (error) {
            if (!(error instanceof CalculatorInputError)) throw error;
            await message.reply({ content: `${calculatorExamples}\n${error.message}`, allowedMentions: { repliedUser: false } });
            return;
        }
        await message.reply({ embeds: [calculationEmbed(context, calculation, false)], allowedMentions: { repliedUser: false } });
    },
};

const slashCalc: SlashCommand = {
    name: 'calc', usage: '/calc <expression>', category: 'Utility', description: 'Crunch numbers with [mathjs](https://mathjs.org).', ownerOnly: false,
    data: new SlashCommandBuilder().setName('calc').setDescription('Crunch numbers with mathjs.')
        .addStringOption(option => option.setName('expression').setDescription('Expression to calculate').setRequired(true).setMaxLength(500)),
    async execute(context, interaction): Promise<void> {
        const expression = interaction.options.getString('expression', true);
        await interaction.deferReply();
        let calculation: Calculation;
        try {
            calculation = await calculate(expression);
        } catch (error) {
            if (!(error instanceof CalculatorInputError)) throw error;
            await interaction.editReply({ content: `${calculatorExamples}\n${error.message}` });
            return;
        }
        await interaction.editReply({ embeds: [calculationEmbed(context, calculation, true)] });
    },
};

function unknownEntity(error: unknown, code: number): boolean {
    return error instanceof DiscordAPIError && error.code === code;
}

const avatar: PrefixCommand = {
    name: 'avatar', aliases: ['av', 'profile', 'pfp'], usage: 'sm avatar <user>', category: 'Utility', description: "Enlarge someone's avatar!", ownerOnly: false,
    async execute(context, message, args): Promise<void> {
        let user: User | undefined = message.author;
        if (args.length) {
            const search = args.join(' ');
            user = context.client.users.cache.find(candidate => candidate.tag === search)
                ?? context.client.users.cache.find(candidate => candidate.username === search);
            const id = args[0];
            if (!user && id && /^\d{17,20}$/.test(id)) {
                try {
                    user = await context.client.users.fetch(id);
                } catch (error) {
                    if (!unknownEntity(error, 10013)) throw error;
                }
            }
            user ??= message.mentions.users.first();
        }
        if (!user) {
            await message.reply({ embeds: [baseEmbed(context).addFields({ name: 'Failed! :no_entry_sign:', value: `I couldn't find a user matching \`${args.join(' ')}\`. Give a mention, user ID, or exact username. Usernames are case-sensitive.` })], allowedMentions: { repliedUser: false } });
            return;
        }
        let member: GuildMember | undefined = message.guild.members.cache.get(user.id);
        if (!member) {
            try {
                member = await message.guild.members.fetch(user.id);
            } catch (error) {
                if (!unknownEntity(error, 10007)) throw error;
            }
        }
        const userButton = new ButtonBuilder().setCustomId('user').setLabel('User Avatar').setStyle(ButtonStyle.Success).setDisabled(true);
        const serverButton = new ButtonBuilder().setCustomId('server').setLabel('Server Avatar').setStyle(ButtonStyle.Secondary).setDisabled(!member?.avatar);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(userButton, serverButton);
        const tag = user.discriminator === '0' ? user.username : user.tag;
        const authorTag = message.author.discriminator === '0' ? message.author.username : message.author.tag;
        const userAvatar = user.displayAvatarURL({ size: 4096 });
        const serverAvatar = member?.avatar ? member.displayAvatarURL({ size: 4096 }) : undefined;
        const embed = baseEmbed(context).setTitle(`${tag}'s avatar`).setImage(userAvatar)
            .setFooter({ text: `Requested by ${authorTag}`, iconURL: message.author.displayAvatarURL() });
        const response = await message.reply({ embeds: [embed], components: [row], allowedMentions: { repliedUser: false } });
        if (!serverAvatar) return;
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button, time: 120_000,
            filter: interaction => interaction.user.id === message.author.id && (interaction.customId === 'user' || interaction.customId === 'server'),
        });
        const ended = Promise.withResolvers<void>();
        let updates = Promise.resolve();
        const onCollect = (interaction: ButtonInteraction): void => {
            const acknowledged = interaction.deferUpdate();
            void acknowledged.catch(() => { collector.stop('error'); });
            updates = updates.then(async () => {
                await acknowledged;
                const server = interaction.customId === 'server';
                embed.setImage(server ? serverAvatar : userAvatar);
                userButton.setDisabled(!server).setStyle(server ? ButtonStyle.Secondary : ButtonStyle.Success);
                serverButton.setDisabled(server).setStyle(server ? ButtonStyle.Success : ButtonStyle.Secondary);
                await interaction.editReply({ embeds: [embed], components: [row] });
            });
            void updates.catch(() => { collector.stop('error'); });
        };
        collector.on('collect', onCollect);
        collector.once('end', () => { ended.resolve(); });
        const unregister = context.lifecycle.registerCleanup(() => { collector.stop('shutdown'); });
        try {
            await ended.promise;
            await updates;
            userButton.setDisabled(true);
            serverButton.setDisabled(true);
            await response.edit({ content: '_This message is now inactive_', embeds: [embed], components: [row] });
        } finally {
            collector.off('collect', onCollect);
            collector.stop();
            unregister();
        }
    },
};

class TimestampInputError extends Error {}

const time: PrefixCommand = {
    name: 'time', aliases: [], usage: 'sm time (model) (message)', category: 'Utility',
    description: "Turn a message's timestamp into a Discord timestamp you can copy. Available formats: t, T, d, D, f, F, R (or r). Reply to a message, provide its ID or link, or use now.", ownerOnly: false,
    async execute(context, message, args): Promise<void> {
        const format = args[0] === 'r' ? 'R' : args[0];
        let timestamp: number;
        try {
            if (!format || !['t', 'T', 'd', 'D', 'f', 'F', 'R'].includes(format)) throw new TimestampInputError(`Pick a format first: t, T, d, D, f, F, or R. See \`${context.config.botPrefix} help time\` for the list.`);
            const reference = message.reference?.messageId;
            const target = args[1];
            if (reference) {
                const referenced = await message.fetchReference();
                timestamp = Math.floor(referenced.createdTimestamp / 1000);
            } else if (target?.toLowerCase() === 'now') {
                timestamp = Math.floor(Date.now() / 1000);
            } else if (target && /^\d{17,20}$/.test(target)) {
                const source = await message.channel.messages.fetch(target);
                timestamp = Math.floor(source.createdTimestamp / 1000);
            } else if (target) {
                const match = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/.exec(target);
                const [, guildId, channelId, messageId] = match ?? [];
                if (guildId !== message.guildId || !channelId || !messageId) throw new TimestampInputError('Give a message link from this server, a message ID, or now.');
                const channel = await message.guild.channels.fetch(channelId);
                if (!channel?.isTextBased()) throw new TimestampInputError("I couldn't read that message's channel.");
                const source = await channel.messages.fetch(messageId);
                timestamp = Math.floor(source.createdTimestamp / 1000);
            } else {
                throw new TimestampInputError('Reply to a message, give a message ID or link, or use now.');
            }
        } catch (error) {
            if (!(error instanceof TimestampInputError) && !unknownEntity(error, 10008) && !unknownEntity(error, 10003) && !unknownEntity(error, 50001) && !unknownEntity(error, 50013)) throw error;
            const reason = error instanceof TimestampInputError ? error.message : "I couldn't read that message. Check its ID or link and my channel permissions.";
            await message.reply({ embeds: [baseEmbed(context).addFields({ name: 'Failed! :no_entry_sign:', value: reason })], allowedMentions: { repliedUser: false } });
            return;
        }
        const result = `<t:${timestamp}:${format}>`;
        await message.reply({ embeds: [baseEmbed(context).setTitle('🕑 Time Converter').addFields({ name: 'Result:', value: result }, { name: 'Copy:', value: `\`${result}\`` })], allowedMentions: { repliedUser: false } });
    },
};

export const prefixCommands: readonly PrefixCommand[] = [avatar, calc, time];
export const slashCommands: readonly SlashCommand[] = [slashCalc];
