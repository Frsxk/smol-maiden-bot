export type Environment = Readonly<Record<string, string | undefined>>;

export interface CategoryProgression {
    readonly fromCategoryId: string;
    readonly toCategoryId: string;
    readonly requiredRoleId: string;
}

export interface RoleMenuButton {
    readonly roleId: string;
    readonly label: string;
    readonly emoji?: string;
    readonly style: 'Primary' | 'Secondary' | 'Success' | 'Danger';
}

export interface RoleMenuConfig {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly footerText: string;
    readonly buttons: readonly RoleMenuButton[];
}

export interface RulesDestination {
    readonly channelId: string;
    readonly messageId: string;
}

export interface ResetPosition {
    readonly group: string;
    readonly channelId: string;
    readonly categoryId: string;
    readonly position: number;
}

/** Missing capabilities stay disabled, including in otherwise configured guilds. */
export interface GuildConfig {
    readonly createChannelCategoryId?: string;
    readonly categoryProgression: readonly CategoryProgression[];
    readonly levelRoleIds: Readonly<Record<string, string>>;
    readonly roleMenus: readonly RoleMenuConfig[];
    readonly rulesDestination?: RulesDestination;
    readonly resetPositions: readonly ResetPosition[];
}

export interface BotConfig {
    readonly token?: string;
    readonly MongoPath?: string;
    readonly botClientID: string;
    readonly ownerID: string;
    readonly botPrefix: string;
    readonly embedColor: `#${string}`;
    readonly embedFooterText: string;
    readonly embedFooterText1: string;
    readonly embedFooterText2: string;
    readonly guilds: Readonly<Record<string, GuildConfig>>;
    readonly blockedChannelIds: readonly string[];
    readonly blockedUserIds: readonly string[];
    readonly petUserId: string;
    readonly pm2ProcessName?: string;
}

function invalid(field: string): never {
    throw new Error(`Invalid configuration: ${field}`);
}

function object(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return invalid(field);
    }
    return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) return invalid(field);
    return value;
}

function snowflake(value: unknown, field: string): string {
    const result = text(value, field);
    if (!/^[1-9]\d{16,19}$/.test(result)) return invalid(field);
    return result;
}

function list<T>(value: unknown, field: string, decode: (item: unknown, field: string) => T): T[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return invalid(field);
    const entries: readonly unknown[] = value;
    return entries.map((item) => decode(item, field));
}

function json(value: string, field: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return invalid(field);
    }
}

function progression(value: unknown, field: string): CategoryProgression {
    const entry = object(value, field);
    const fromCategoryId = snowflake(entry.fromCategoryId, `${field}.fromCategoryId`);
    const toCategoryId = snowflake(entry.toCategoryId, `${field}.toCategoryId`);
    if (fromCategoryId === toCategoryId) return invalid(field);
    return {
        fromCategoryId,
        toCategoryId,
        requiredRoleId: snowflake(entry.requiredRoleId, `${field}.requiredRoleId`),
    };
}

function roleButton(value: unknown, field: string): RoleMenuButton {
    const entry = object(value, field);
    const style = entry.style ?? 'Secondary';
    if (style !== 'Primary' && style !== 'Secondary' && style !== 'Success' && style !== 'Danger') {
        return invalid(`${field}.style`);
    }
    return {
        roleId: snowflake(entry.roleId, `${field}.roleId`),
        label: text(entry.label, `${field}.label`),
        style,
        ...(entry.emoji === undefined ? {} : { emoji: text(entry.emoji, `${field}.emoji`) }),
    };
}

function roleMenu(value: unknown, field: string): RoleMenuConfig {
    const entry = object(value, field);
    const buttons = list(entry.buttons, `${field}.buttons`, roleButton);
    if (buttons.length === 0 || buttons.length > 25) return invalid(`${field}.buttons`);
    return {
        id: text(entry.id, `${field}.id`),
        title: text(entry.title, `${field}.title`),
        description: text(entry.description, `${field}.description`),
        footerText: text(entry.footerText, `${field}.footerText`),
        buttons,
    };
}

function resetPosition(value: unknown, field: string): ResetPosition {
    const entry = object(value, field);
    const position = entry.position;
    if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) {
        return invalid(`${field}.position`);
    }
    return {
        group: text(entry.group, `${field}.group`),
        channelId: snowflake(entry.channelId, `${field}.channelId`),
        categoryId: snowflake(entry.categoryId, `${field}.categoryId`),
        position,
    };
}

function guild(value: unknown): GuildConfig {
    const entry = object(value, 'GUILD_CONFIG_JSON.guild');
    const levelRoleIds: Record<string, string> = {};
    if (entry.levelRoleIds !== undefined) {
        for (const [level, id] of Object.entries(object(entry.levelRoleIds, 'GUILD_CONFIG_JSON.levelRoleIds'))) {
            Object.defineProperty(levelRoleIds, level, {
                value: snowflake(id, 'GUILD_CONFIG_JSON.levelRoleIds'), enumerable: true,
            });
        }
    }
    let rulesDestination: RulesDestination | undefined;
    if (entry.rulesDestination !== undefined) {
        const rules = object(entry.rulesDestination, 'GUILD_CONFIG_JSON.rulesDestination');
        rulesDestination = {
            channelId: snowflake(rules.channelId, 'GUILD_CONFIG_JSON.rulesDestination.channelId'),
            messageId: snowflake(rules.messageId, 'GUILD_CONFIG_JSON.rulesDestination.messageId'),
        };
    }
    return {
        ...(entry.createChannelCategoryId === undefined ? {} : {
            createChannelCategoryId: snowflake(entry.createChannelCategoryId, 'GUILD_CONFIG_JSON.createChannelCategoryId'),
        }),
        categoryProgression: list(entry.categoryProgression, 'GUILD_CONFIG_JSON.categoryProgression', progression),
        levelRoleIds,
        roleMenus: list(entry.roleMenus, 'GUILD_CONFIG_JSON.roleMenus', roleMenu),
        ...(rulesDestination === undefined ? {} : { rulesDestination }),
        resetPositions: list(entry.resetPositions, 'GUILD_CONFIG_JSON.resetPositions', resetPosition),
    };
}

function guilds(value: string | undefined): Readonly<Record<string, GuildConfig>> {
    if (value === undefined) return {};
    const result: Record<string, GuildConfig> = {};
    for (const [id, entry] of Object.entries(object(json(value, 'GUILD_CONFIG_JSON'), 'GUILD_CONFIG_JSON'))) {
        result[snowflake(id, 'GUILD_CONFIG_JSON.guildId')] = guild(entry);
    }
    return result;
}

function optionalText(env: Environment, key: string): string | undefined {
    const value = env[key];
    return value === undefined || value.trim() === '' ? undefined : text(value, key);
}

/** Reads only its argument; callers own dotenv loading and runtime connections. */
export function loadConfig(env: Environment): BotConfig {
    const token = optionalText(env, 'TOKEN');
    if (token !== undefined && /\s/.test(token)) return invalid('TOKEN');
    const MongoPath = optionalText(env, 'MONGODB');
    if (MongoPath !== undefined && !/^mongodb(?:\+srv)?:\/\/\S+$/.test(MongoPath)) {
        return invalid('MONGODB');
    }
    const embedColor = env.EMBED_COLOR ?? '#ffb8bf';
    if (!/^#[0-9a-fA-F]{6}$/.test(embedColor)) return invalid('EMBED_COLOR');
    const pm2ProcessName = optionalText(env, 'PM2_PROCESS_NAME');
    if (pm2ProcessName !== undefined && (!/^[\w.-]+$/.test(pm2ProcessName) || pm2ProcessName.startsWith('-'))) {
        return invalid('PM2_PROCESS_NAME');
    }
    return {
        ...(token === undefined ? {} : { token }),
        ...(MongoPath === undefined ? {} : { MongoPath }),
        botClientID: snowflake(env.BOT_CLIENT_ID ?? '953610843692617788', 'BOT_CLIENT_ID'),
        ownerID: snowflake(env.OWNER_ID ?? '543313602942337035', 'OWNER_ID'),
        botPrefix: text(env.BOT_PREFIX ?? 'sm ', 'BOT_PREFIX'),
        embedColor: embedColor as `#${string}`,
        embedFooterText: text(env.EMBED_FOOTER_TEXT ?? 'Made with ❤️ using Discord.js', 'EMBED_FOOTER_TEXT'),
        embedFooterText1: text(env.EMBED_FOOTER_TEXT_1 ?? "Find more commands with 'sm help'", 'EMBED_FOOTER_TEXT_1'),
        embedFooterText2: text(env.EMBED_FOOTER_TEXT_2 ?? "Find more commands with '/help'", 'EMBED_FOOTER_TEXT_2'),
        guilds: guilds(env.GUILD_CONFIG_JSON),
        blockedChannelIds: env.BLOCKED_CHANNEL_IDS === undefined
            ? ['674556658248187926', '954368773090082846', '954368755872464926', '956890086845317122']
            : list(json(env.BLOCKED_CHANNEL_IDS, 'BLOCKED_CHANNEL_IDS'), 'BLOCKED_CHANNEL_IDS', snowflake),
        blockedUserIds: env.BLOCKED_USER_IDS === undefined
            ? ['12345678909876543456']
            : list(json(env.BLOCKED_USER_IDS, 'BLOCKED_USER_IDS'), 'BLOCKED_USER_IDS', snowflake),
        petUserId: snowflake(env.PET_USER_ID ?? '445158576281878539', 'PET_USER_ID'),
        ...(pm2ProcessName === undefined ? {} : { pm2ProcessName }),
    };
}
