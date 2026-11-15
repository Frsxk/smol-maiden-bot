import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config';
import type { Environment } from '../src/config';

const guildId = '111111111111111111';
const otherGuildId = '222222222222222222';
const channelId = '333333333333333333';
const categoryId = '444444444444444444';
const roleId = '555555555555555555';
const messageId = '666666666666666666';

function rejectsConfig(env: Environment, field: string, secrets: readonly string[] = []): void {
    assert.throws(() => loadConfig(env), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, `Invalid configuration: ${field}`);
        for (const secret of secrets) {
            assert.equal(error.message.includes(secret), false);
            assert.equal(error.stack?.includes(secret), false);
        }
        return true;
    });
}

function guildEnvironment(value: unknown): Environment {
    return { GUILD_CONFIG_JSON: JSON.stringify({ [guildId]: value }) };
}

test('configuration reads only supplied values and leaves optional connections absent', () => {
    const env = Object.freeze({});
    const config = loadConfig(env);
    assert.equal(Object.hasOwn(config, 'token'), false);
    assert.equal(Object.hasOwn(config, 'MongoPath'), false);
    assert.equal(Object.hasOwn(config, 'pm2ProcessName'), false);
    assert.deepEqual(config.guilds, {});
    assert.deepEqual(env, {});
});

test('blank optional credentials are absent and valid credentials are preserved', () => {
    const absent = loadConfig({ TOKEN: ' \t ', MONGODB: ' ', PM2_PROCESS_NAME: '\t' });
    assert.equal(Object.hasOwn(absent, 'token'), false);
    assert.equal(Object.hasOwn(absent, 'MongoPath'), false);
    assert.equal(Object.hasOwn(absent, 'pm2ProcessName'), false);
    const token = 'isolated-test-token';
    for (const uri of ['mongodb://localhost:27017/smol', 'mongodb+srv://user:password@cluster.example/smol']) {
        const config = loadConfig({ TOKEN: token, MONGODB: uri, PM2_PROCESS_NAME: 'smol-maiden.1' });
        assert.equal(config.token, token);
        assert.equal(config.MongoPath, uri);
        assert.equal(config.pm2ProcessName, 'smol-maiden.1');
    }
});

test('credential errors identify fields without exposing tokens or Mongo credentials', () => {
    const token = 'private-token with-whitespace';
    rejectsConfig({ TOKEN: token }, 'TOKEN', [token, 'private-token']);
    const mongo = 'https://private-user:private-password@database.example';
    rejectsConfig({ TOKEN: 'private-valid-token', MONGODB: mongo }, 'MONGODB', [mongo, 'private-password', 'private-valid-token']);
    const malformedMapping = '{"private-payload":';
    rejectsConfig({ TOKEN: 'private-valid-token', GUILD_CONFIG_JSON: malformedMapping }, 'GUILD_CONFIG_JSON', ['private-payload', 'private-valid-token']);
});

test('prefixes retain command-significant trailing spaces', () => {
    assert.equal(loadConfig({}).botPrefix, 'sm ');
    assert.equal(loadConfig({ BOT_PREFIX: 'custom  ' }).botPrefix, 'custom  ');
    rejectsConfig({ BOT_PREFIX: ' \t ' }, 'BOT_PREFIX');
});

test('missing guild capabilities stay disabled without inheriting another guild configuration', () => {
    const config = loadConfig({ GUILD_CONFIG_JSON: JSON.stringify({
        [guildId]: { createChannelCategoryId: categoryId },
        [otherGuildId]: {},
    }) });
    assert.equal(config.guilds[guildId]?.createChannelCategoryId, categoryId);
    assert.deepEqual(config.guilds[otherGuildId], {
        categoryProgression: [], levelRoleIds: {}, roleMenus: [], resetPositions: [],
    });
    assert.equal(Object.hasOwn(config.guilds[otherGuildId] ?? {}, 'createChannelCategoryId'), false);
    assert.equal(Object.hasOwn(config.guilds[otherGuildId] ?? {}, 'rulesDestination'), false);
    assert.equal(config.guilds['777777777777777777'], undefined);
});

test('configured guild capabilities decode independently', () => {
    const capabilities = {
        createChannelCategoryId: categoryId,
        categoryProgression: [{ fromCategoryId: channelId, toCategoryId: categoryId, requiredRoleId: roleId }],
        levelRoleIds: { '10': roleId },
        roleMenus: [{
            id: 'colors', title: 'Colors', description: 'Choose a color', footerText: 'One role per choice',
            buttons: [{ roleId, label: 'Red', emoji: '🔴', style: 'Danger' }],
        }],
        rulesDestination: { channelId, messageId },
        resetPositions: [{ group: 'main', channelId, categoryId, position: 0 }],
    };
    assert.deepEqual(loadConfig(guildEnvironment(capabilities)).guilds[guildId], capabilities);
    const defaultButton = loadConfig(guildEnvironment({ roleMenus: [{
        id: 'roles', title: 'Roles', description: 'Choose a role', footerText: 'Roles',
        buttons: [{ roleId, label: 'Member' }],
    }] })).guilds[guildId]?.roleMenus[0]?.buttons[0];
    assert.deepEqual(defaultButton, { roleId, label: 'Member', style: 'Secondary' });
});

test('malformed guild maps reject syntax, root shapes, guild keys, and entry shapes', () => {
    for (const value of ['{', 'null', '[]', '"guild"', '42']) {
        rejectsConfig({ GUILD_CONFIG_JSON: value }, 'GUILD_CONFIG_JSON');
    }
    rejectsConfig({ GUILD_CONFIG_JSON: '{"not-a-snowflake":{}}' }, 'GUILD_CONFIG_JSON.guildId');
    for (const value of [null, [], 'guild', 42]) {
        rejectsConfig(guildEnvironment(value), 'GUILD_CONFIG_JSON.guild');
    }
});

test('malformed optional guild capabilities reject their own fields', () => {
    const cases: readonly [unknown, string][] = [
        [{ createChannelCategoryId: 'invalid' }, 'createChannelCategoryId'],
        [{ categoryProgression: {} }, 'categoryProgression'],
        [{ categoryProgression: [{ fromCategoryId: categoryId, toCategoryId: categoryId, requiredRoleId: roleId }] }, 'categoryProgression'],
        [{ categoryProgression: [{ fromCategoryId: channelId, toCategoryId: categoryId, requiredRoleId: 123 }] }, 'categoryProgression.requiredRoleId'],
        [{ levelRoleIds: [] }, 'levelRoleIds'],
        [{ levelRoleIds: { '10': 'invalid' } }, 'levelRoleIds'],
        [{ roleMenus: {} }, 'roleMenus'],
        [{ roleMenus: [{ buttons: [] }] }, 'roleMenus.buttons'],
        [{ roleMenus: [{ buttons: Array.from({ length: 26 }, () => ({ roleId, label: 'Role' })) }] }, 'roleMenus.buttons'],
        [{ roleMenus: [{ buttons: [{ roleId, label: 'Role', style: 'Link' }] }] }, 'roleMenus.buttons.style'],
        [{ rulesDestination: { channelId, messageId: 'invalid' } }, 'rulesDestination.messageId'],
        [{ resetPositions: [{ group: 'main', channelId, categoryId, position: -1 }] }, 'resetPositions.position'],
        [{ resetPositions: [{ group: 'main', channelId, categoryId, position: 1.5 }] }, 'resetPositions.position'],
        [{ resetPositions: [{ group: 'main', channelId, categoryId, position: Number.MAX_SAFE_INTEGER + 1 }] }, 'resetPositions.position'],
    ];
    for (const [value, field] of cases) {
        rejectsConfig(guildEnvironment(value), `GUILD_CONFIG_JSON.${field}`);
    }
});

test('snowflake fields reject malformed IDs rather than coercing values', () => {
    const invalidIds = ['', '0', '012345678901234567', '1234567890123456', '123456789012345678901', '11111111111111111x', ` ${channelId}`, `${channelId} `];
    for (const field of ['BOT_CLIENT_ID', 'OWNER_ID', 'PET_USER_ID']) {
        for (const value of invalidIds) rejectsConfig({ [field]: value }, field);
    }
    for (const field of ['BLOCKED_CHANNEL_IDS', 'BLOCKED_USER_IDS']) {
        for (const value of ['{}', 'null', '[123]', '["invalid"]', '[']) {
            rejectsConfig({ [field]: value }, field);
        }
        assert.deepEqual(loadConfig({ [field]: '[]' })[field === 'BLOCKED_CHANNEL_IDS' ? 'blockedChannelIds' : 'blockedUserIds'], []);
        assert.deepEqual(loadConfig({ [field]: JSON.stringify([channelId]) })[field === 'BLOCKED_CHANNEL_IDS' ? 'blockedChannelIds' : 'blockedUserIds'], [channelId]);
    }
});

test('embed colors require exactly six hexadecimal digits', () => {
    assert.equal(loadConfig({ EMBED_COLOR: '#aBcD09' }).embedColor, '#aBcD09');
    for (const value of ['', '#fff', 'ffb8bf', '#fffffff', '#gg0000', ' #ffffff']) {
        rejectsConfig({ EMBED_COLOR: value }, 'EMBED_COLOR');
    }
});

test('PM2 names cannot supply shell syntax or command options', () => {
    for (const value of ['-bot', '--all', 'bot name', 'bot;exit', 'bot/child', 'bot\nnext', '$(exit)', 'bot&next']) {
        rejectsConfig({ PM2_PROCESS_NAME: value }, 'PM2_PROCESS_NAME');
    }
});

test('configured footer text cannot be blank', () => {
    for (const field of ['EMBED_FOOTER_TEXT', 'EMBED_FOOTER_TEXT_1', 'EMBED_FOOTER_TEXT_2']) {
        rejectsConfig({ [field]: ' \t' }, field);
    }
});
