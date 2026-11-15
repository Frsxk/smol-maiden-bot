import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, DiscordAPIError, EmbedBuilder,
    MessageFlags, PermissionFlagsBits,
} from 'discord.js';
import type { Client, InteractionDeferReplyOptions, InteractionEditReplyOptions, MessageCreateOptions, MessageEditOptions } from 'discord.js';
import { GiveawayUserError } from './service';
import type { GiveawayLocation, GiveawayRecord, GiveawayService, GiveawayTransport, LocatedGiveaway } from './service';

export const giveawayCustomIds = ['enter_giveaway', 'end_giveaway', 'reroll_giveaway'] as const;

export interface GiveawayButtonInteraction {
    customId: string;
    guildId: string | null;
    channelId: string;
    user: { id: string };
    message: { id: string };
    deferReply(options: InteractionDeferReplyOptions): Promise<unknown>;
    editReply(options: InteractionEditReplyOptions): Promise<unknown>;
}

export function createGiveawayPresentation(record: GiveawayRecord, preparing = false) {
    const completed = record.completed === true || record.endTime === null;
    const embed = new EmbedBuilder().setTitle(record.prize).setDescription(record.description || null)
        .addFields({ name: 'Host', value: `<@${record.host}>`, inline: true },
            { name: 'Entries', value: String(record.entered), inline: true },
            { name: 'Winners', value: String(record.winCount), inline: true });
    if (completed) {
        embed.setFooter({ text: 'Giveaway ended' });
        const winners = record.winners ?? [];
        if (winners.length === 0) embed.addFields({ name: 'Result', value: 'No eligible entries.' });
        for (let offset = 0; offset < winners.length; offset += 35) {
            embed.addFields({ name: offset === 0 ? 'Selected winners' : 'Selected winners (continued)', value: winners.slice(offset, offset + 35).map(id => `<@${id}>`).join(', ') });
        }
    } else {
        embed.addFields({ name: 'Ends', value: `<t:${Math.floor(Number(record.endTime) / 1000)}:R>` });
        if (record.requirements.type !== 'none') embed.addFields({ name: 'Requirement', value: record.requirements.type === 'role' ? `Role <@&${record.requirements.id}>` : `Membership in server ${record.requirements.id}` });
        embed.setFooter({ text: preparing ? 'Saving giveaway. Entry opens after it is saved.' : 'Press Enter / leave to toggle your entry.' });
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('enter_giveaway').setLabel('Enter / leave').setStyle(ButtonStyle.Primary).setDisabled(preparing || completed),
        new ButtonBuilder().setCustomId(completed ? 'reroll_giveaway' : 'end_giveaway').setLabel(completed ? 'Reroll' : 'End giveaway').setStyle(ButtonStyle.Secondary).setDisabled(preparing),
    );
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] as never[] } };
}

export function createDiscordGiveawayTransport(client: Client): GiveawayTransport {
    async function channel(location: GiveawayLocation) {
        const result = await client.channels.fetch(location.channelId);
        if (!result || !result.isTextBased() || result.isDMBased() || !result.isSendable() || result.guildId !== location.guildId) throw new Error('Giveaway channel is unavailable or belongs to a different server.');
        return result;
    }
    return {
        async create(location, draft) {
            const target = await channel(location);
            const options: MessageCreateOptions = createGiveawayPresentation({ ...draft, message: '' }, true);
            return (await target.send(options)).id;
        },
        async verify(location, messageId) {
            const target = await channel(location);
            const message = await target.messages.fetch(messageId);
            return message.id === messageId && message.guildId === location.guildId && message.channelId === location.channelId
                && message.author.id === client.user?.id
                && message.components.some(row => 'components' in row && row.components.some(component => 'customId' in component && giveawayCustomIds.some(id => id === component.customId)));
        },
        async member(guildId, userId) {
            const guild = await client.guilds.fetch(guildId);
            try {
                const member = await guild.members.fetch({ user: userId, force: true });
                return {
                    userId, roleIds: [...member.roles.cache.keys()], bot: member.user.bot,
                    administrator: member.permissions.has(PermissionFlagsBits.Administrator),
                    manageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
                    manageEvents: member.permissions.has(PermissionFlagsBits.ManageEvents),
                };
            } catch (error) {
                if (error instanceof DiscordAPIError && error.code === 10007) return null;
                throw error;
            }
        },
        async publish(record) {
            const target = await channel(record);
            const message = await target.messages.fetch(record.message);
            if (message.author.id !== client.user?.id) throw new Error('Cannot edit a giveaway message belonging to another author.');
            const options: MessageEditOptions = createGiveawayPresentation(record);
            await message.edit(options);
        },
        async discard(location, messageId) {
            const target = await channel(location);
            const message = await target.messages.fetch(messageId);
            if (message.author.id !== client.user?.id) throw new Error('Cannot discard another author’s message.');
            await message.delete();
        },
    };
}

export async function handleGiveawayInteraction(interaction: GiveawayButtonInteraction, service: GiveawayService): Promise<boolean> {
    if (!giveawayCustomIds.some(id => id === interaction.customId)) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let response: string;
    try {
        if (!interaction.guildId) throw new GiveawayUserError('Giveaway controls only work in a server.');
        const actor = { guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id };
        if (interaction.customId === 'enter_giveaway') {
            const result = await service.toggleEntry(interaction.message.id, actor);
            response = result.entered ? 'You entered the giveaway.' : 'Your entry was removed.';
        } else {
            const record: LocatedGiveaway = interaction.customId === 'end_giveaway'
                ? await service.end(interaction.message.id, actor)
                : await service.reroll(interaction.message.id, actor);
            response = record.winners?.length ? 'The selected winners are published on the giveaway.' : 'Giveaway ended with no eligible entries.';
        }
    } catch (error) {
        if (error instanceof GiveawayUserError) {
            response = `Giveaway operation did not complete: ${error.message}`.slice(0, 2000);
        } else {
            console.error('Giveaway interaction failed.', { control: interaction.customId, phase: 'operation' });
            response = 'Giveaway operation did not complete. Please try again later.';
        }
    }
    try {
        await interaction.editReply({ content: response, allowedMentions: { parse: [] } });
    } catch {
        console.error('Giveaway interaction failed.', { control: interaction.customId, phase: 'reply' });
    }
    return true;
}
