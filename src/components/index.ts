import { MessageFlags, type ButtonInteraction } from 'discord.js';
import type { AppContext } from '../commands/types';
import { giveawayCustomIds, handleGiveawayInteraction } from '../features/giveaways/discord';
import type { GiveawayService } from '../features/giveaways/service';
import { menuRole } from './roles';

export async function handlePersistentComponent(context: AppContext, interaction: ButtonInteraction, giveaways: GiveawayService | null): Promise<boolean> {
    if (giveawayCustomIds.some(id => id === interaction.customId)) {
        if (giveaways) return handleGiveawayInteraction(interaction, giveaways);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply({ content: 'Giveaways are unavailable. Ask the operator to configure the database.', allowedMentions: { parse: [] } });
        return true;
    }
    const match = /^role-(\d+)$/.exec(interaction.customId);
    const roleId = match?.[1];
    if (!roleId) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const config = interaction.guildId ? context.config.guilds[interaction.guildId] : undefined;
        const allowed = config?.roleMenus.some(menu => menu.buttons.some(button => button.roleId === roleId));
        if (!interaction.guild || !allowed || interaction.message.author.id !== context.client.user?.id) {
            await interaction.editReply({ content: 'This role control is not a configured bot role menu.', allowedMentions: { parse: [] } });
            return true;
        }
        const role = await menuRole(interaction.guild, roleId);
        if (!role) {
            await interaction.editReply({ content: 'That role cannot be self-assigned. Check role permissions and the bot role hierarchy.', allowedMentions: { parse: [] } });
            return true;
        }
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const remove = member.roles.cache.has(role.id);
        if (remove) await member.roles.remove(role, 'Configured role menu');
        else await member.roles.add(role, 'Configured role menu');
        await interaction.editReply({ content: remove ? 'Your role was removed.' : 'Your role was added.', allowedMentions: { parse: [] } });
    } catch (error) {
        console.error('Role menu operation failed:', error);
        await interaction.editReply({ content: 'The role change did not complete. Ask the operator to check the bot permissions.', allowedMentions: { parse: [] } });
    }
    return true;
}
