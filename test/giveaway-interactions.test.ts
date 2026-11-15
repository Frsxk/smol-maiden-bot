import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageFlags } from 'discord.js';
import type { InteractionDeferReplyOptions, InteractionEditReplyOptions } from 'discord.js';
import { createGiveawayPresentation, handleGiveawayInteraction } from '../src/features/giveaways/discord';
import type { GiveawayButtonInteraction } from '../src/features/giveaways/discord';
import { GiveawayUserError } from '../src/features/giveaways/service';
import type { GiveawayService, LocatedGiveaway } from '../src/features/giveaways/service';

const record: LocatedGiveaway = {
    guildId: 'guild', channelId: 'channel', message: 'message', host: 'host', prize: 'Prize',
    started: 1, entry: [], entered: 0, winCount: 1, requirements: { type: 'none' },
    endTime: '2000', description: '', embeds: {},
};
function serviceWith(overrides: Partial<GiveawayService> = {}): GiveawayService {
    return {
        async start() { assert.fail('Unexpected service start'); },
        async create() { assert.fail('Unexpected giveaway creation'); },
        async toggleEntry() { return { entered: true, record }; },
        async end() { return { ...record, completed: true, endTime: null, winners: ['winner'] }; },
        async reroll() { return { ...record, completed: true, endTime: null, winners: ['winner'] }; },
        async stop() { assert.fail('Unexpected service stop'); },
        ...overrides,
    };
}
function interactionWith(overrides: Partial<GiveawayButtonInteraction> = {}) {
    const deferrals: InteractionDeferReplyOptions[] = [];
    const replies: InteractionEditReplyOptions[] = [];
    const interaction: GiveawayButtonInteraction = {
        customId: 'enter_giveaway', guildId: 'guild', channelId: 'channel',
        user: { id: 'user' }, message: { id: 'message' },
        async deferReply(options) { deferrals.push(options); },
        async editReply(options) { replies.push(options); },
        ...overrides,
    };
    return { interaction, deferrals, replies };
}

test('only explicit giveaway domain errors are presented to the user', async () => {
    const f = interactionWith();
    const service = serviceWith({ async toggleEntry() { throw new GiveawayUserError('You do not meet the entry requirements.'); } });
    assert.equal(await handleGiveawayInteraction(f.interaction, service), true);
    assert.deepEqual(f.deferrals, [{ flags: MessageFlags.Ephemeral }]);
    assert.deepEqual(f.replies, [{
        content: 'Giveaway operation did not complete: You do not meet the entry requirements.',
        allowedMentions: { parse: [] },
    }]);
});

test('unexpected failures redact messages, names, codes, stacks and credentials from replies and diagnostics', async t => {
    const logs: unknown[][] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
    const secret = 'mongodb://username:secret-password@private.example/db?token=private-token';
    const error = Object.assign(new Error(secret), { name: secret, code: secret });
    const f = interactionWith();
    assert.equal(await handleGiveawayInteraction(f.interaction, serviceWith({ async toggleEntry() { throw error; } })), true);
    assert.deepEqual(f.replies, [{
        content: 'Giveaway operation did not complete. Please try again later.', allowedMentions: { parse: [] },
    }]);
    assert.deepEqual(logs, [['Giveaway interaction failed.', { control: 'enter_giveaway', phase: 'operation' }]]);
    assert.ok(!JSON.stringify([f.replies, logs]).includes(secret));
    assert.equal(f.deferrals.length, 1);
});

test('a failed reply write is contained without retrying or acknowledging again', async t => {
    const logs: unknown[][] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
    for (const operationFails of [false, true]) {
        let writes = 0;
        const f = interactionWith({ async editReply() { writes++; throw new Error('https://secret-token@example.invalid'); } });
        const service = serviceWith({ async toggleEntry() {
            if (operationFails) throw new GiveawayUserError('This giveaway has ended.');
            return { entered: true, record };
        } });
        assert.equal(await handleGiveawayInteraction(f.interaction, service), true);
        assert.equal(writes, 1);
        assert.deepEqual(f.deferrals, [{ flags: MessageFlags.Ephemeral }]);
    }
    assert.deepEqual(logs, [
        ['Giveaway interaction failed.', { control: 'enter_giveaway', phase: 'reply' }],
        ['Giveaway interaction failed.', { control: 'enter_giveaway', phase: 'reply' }],
    ]);
});

test('every recognized control acknowledges once before invoking its service method', async () => {
    for (const customId of ['enter_giveaway', 'end_giveaway', 'reroll_giveaway']) {
        const f = interactionWith({ customId });
        const calls: string[] = [];
        function checkCall(method: string, messageId: string, actor: unknown) {
            assert.deepEqual(f.deferrals, [{ flags: MessageFlags.Ephemeral }]);
            assert.deepEqual(f.replies, []);
            assert.equal(messageId, 'message');
            assert.deepEqual(actor, { guildId: 'guild', channelId: 'channel', userId: 'user' });
            calls.push(method);
        }
        const service = serviceWith({
            async toggleEntry(messageId, actor) { checkCall('enter_giveaway', messageId, actor); return { entered: true, record }; },
            async end(messageId, actor) { checkCall('end_giveaway', messageId, actor); return record; },
            async reroll(messageId, actor) { checkCall('reroll_giveaway', messageId, actor); return record; },
        });
        assert.equal(await handleGiveawayInteraction(f.interaction, service), true);
        assert.deepEqual(calls, [customId]);
        assert.equal(f.deferrals.length, 1);
        assert.equal(f.replies.length, 1);
        assert.deepEqual(f.replies[0]?.allowedMentions, { parse: [] });
    }
});

test('unrecognized controls are untouched', async () => {
    const f = interactionWith({ customId: 'other-feature' });
    const service = serviceWith({ async toggleEntry() { assert.fail('Unknown control reached giveaway service'); } });
    assert.equal(await handleGiveawayInteraction(f.interaction, service), false);
    assert.deepEqual(f.deferrals, []);
    assert.deepEqual(f.replies, []);
});

test('initial acknowledgement failure propagates without service work or a second response', async () => {
    const failure = new Error('Cannot acknowledge');
    let acknowledgements = 0;
    const f = interactionWith({ async deferReply() { acknowledgements++; throw failure; } });
    const service = serviceWith({ async toggleEntry() { assert.fail('Unacknowledged interaction reached service'); } });
    await assert.rejects(handleGiveawayInteraction(f.interaction, service), error => error === failure);
    assert.equal(acknowledgements, 1);
    assert.deepEqual(f.replies, []);
});

test('maximum-size giveaway renders every winner within field and total embed limits', () => {
    const winners = Array.from({ length: 100 }, (_, index) => `10000000000000000${String(index).padStart(3, '0')}`);
    const output = createGiveawayPresentation({
        ...record, completed: true, endTime: null, winCount: 100, entered: 100,
        host: '10000000000000000000', prize: 'p'.repeat(256), description: 'd'.repeat(3000), winners,
    });
    const embed = output.embeds[0];
    assert.ok(embed);
    const json = embed.toJSON();
    const fields = json.fields ?? [];
    assert.ok(fields.length <= 25);
    assert.ok(fields.every(field => field.value.length <= 1024 && field.name.length <= 256));
    assert.ok((json.description?.length ?? 0) <= 4096);
    assert.ok(embed.length <= 6000);
    const selected = fields.filter(field => field.name.startsWith('Selected winners'));
    assert.deepEqual(selected.flatMap(field => field.value.split(', ')), winners.map(id => `<@${id}>`));
    assert.deepEqual(output.allowedMentions, { parse: [] });
});
