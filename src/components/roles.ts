import { PermissionFlagsBits, type Guild, type Role } from 'discord.js';

const privilegedPermissions = [
    PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.MentionEveryone,
    PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.ManageEvents,
    PermissionFlagsBits.ManageGuildExpressions, PermissionFlagsBits.ViewAuditLog,
    PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers,
];

export async function menuRole(guild: Guild, roleId: string): Promise<Role | null> {
    const [role, bot] = await Promise.all([guild.roles.fetch(roleId), guild.members.fetchMe()]);
    if (!role || role.id === guild.id || role.managed || !bot.permissions.has(PermissionFlagsBits.ManageRoles)
        || bot.roles.highest.comparePositionTo(role) <= 0 || role.permissions.any(privilegedPermissions)) return null;
    return role;
}
