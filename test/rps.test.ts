import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RpsSession, rpsOutcome, type RpsChoice, type RpsClock, type RpsState } from '../src/features/rps/session';

class ManualClock implements RpsClock {
    now = 0;
    private nextId = 0;
    readonly pending = new Map<number, { at: number; callback: () => void }>();

    schedule(milliseconds: number, callback: () => void): () => void {
        const id = this.nextId++;
        this.pending.set(id, { at: this.now + milliseconds, callback });
        return () => { this.pending.delete(id); };
    }

    advance(milliseconds: number): void {
        this.now += milliseconds;
        for (const [id, timer] of [...this.pending]) {
            if (timer.at <= this.now && this.pending.delete(id)) timer.callback();
        }
    }
}

function game() {
    const clock = new ManualClock();
    const changes: RpsState[] = [];
    const session = new RpsSession('game-message', { challenger: 'alice', opponent: 'bob' }, {
        clock, onChange(state) { changes.push(state); },
    });
    const input = (action: 'accept' | 'decline' | RpsChoice, user = 'bob') => session.input(session.customId(action), user);
    return { session, clock, changes, input };
}

test('RPS outcome covers all nine combinations', () => {
    const choices: readonly RpsChoice[] = ['rock', 'paper', 'scissors'];
    const matrix = {
        rock: { rock: 'draw', paper: 'opponent', scissors: 'challenger' },
        paper: { rock: 'challenger', paper: 'draw', scissors: 'opponent' },
        scissors: { rock: 'opponent', paper: 'challenger', scissors: 'draw' },
    } as const;
    for (const first of choices) {
        for (const second of choices) assert.equal(rpsOutcome(first, second), matrix[first][second]);
    }
});

test('session rejects invalid participants at construction', () => {
    assert.throws(() => new RpsSession('id', { challenger: 'alice', opponent: 'alice' }));
    assert.throws(() => new RpsSession('id', { challenger: '', opponent: 'bob' }));
    assert.throws(() => new RpsSession('', { challenger: 'alice', opponent: 'bob' }));
});

test('invitation validates custom IDs, action, outsider and invited participant before mutation', async () => {
    const { session, clock, changes, input } = game();
    const initial = session.state;
    assert.equal(session.input('rps:other-message:accept', 'bob'), 'invalid');
    assert.equal(session.input('rps:game-message:accept:extra', 'bob'), 'invalid');
    assert.equal(session.input('rps:game-message:unknown', 'bob'), 'invalid');
    assert.equal(input('accept', 'eve'), 'outsider');
    assert.equal(input('decline', 'eve'), 'outsider');
    assert.equal(input('accept', 'alice'), 'invited-only');
    assert.equal(input('decline', 'alice'), 'invited-only');
    assert.equal(input('rock'), 'invalid');
    assert.equal(session.state, initial);
    assert.equal(changes.length, 0);
    assert.equal(clock.pending.size, 1);
    assert.equal(input('accept'), 'accepted');
    assert.deepEqual(session.state, { phase: 'choosing', challenger: null, opponent: null });
    assert.equal(clock.pending.size, 1, 'accept replaces the invitation timer');
    session.shutdown();
    assert.deepEqual(await session.done, { phase: 'ended', reason: 'shutdown' });
});

test('invitation decline settles and releases timer exactly once', async () => {
    const { session, clock, changes, input } = game();
    assert.equal(input('decline'), 'accepted');
    const result = await session.done;
    assert.deepEqual(result, { phase: 'ended', reason: 'declined' });
    assert.equal(clock.pending.size, 0);
    assert.equal(input('accept'), 'finished');
    clock.advance(60_000);
    session.shutdown();
    session.fail();
    assert.equal(session.state, result);
    assert.equal(changes.length, 1);
});

test('unanswered invitation expires at 30 seconds and settles', async () => {
    const { session, clock } = game();
    clock.advance(29_999);
    assert.equal(session.state.phase, 'invitation');
    clock.advance(1);
    assert.deepEqual(await session.done, { phase: 'ended', reason: 'invitation-timeout' });
    assert.equal(clock.pending.size, 0);
});

test('acceptance starts a new 30-second choice deadline, including when one player has chosen', async () => {
    const { session, clock, input } = game();
    clock.advance(29_000);
    input('accept');
    clock.advance(1_000);
    assert.equal(session.state.phase, 'choosing', 'old invitation deadline was cancelled');
    input('paper', 'alice');
    clock.advance(28_999);
    assert.equal(session.state.phase, 'choosing');
    clock.advance(1);
    assert.deepEqual(await session.done, { phase: 'ended', reason: 'choice-timeout' });
    assert.equal(clock.pending.size, 0);
});

test('choice phase rejects outsiders, duplicate choices and stale invitation controls without changing state', async () => {
    const { session, input, changes } = game();
    input('accept');
    assert.equal(input('rock', 'alice'), 'accepted');
    const chosen = session.state;
    assert.equal(input('paper', 'alice'), 'duplicate');
    assert.equal(input('scissors', 'eve'), 'outsider');
    assert.equal(input('accept'), 'invalid');
    assert.equal(input('decline'), 'invalid');
    assert.equal(session.input('rps:another-game:scissors', 'bob'), 'invalid');
    assert.equal(session.state, chosen);
    assert.equal(changes.length, 2);
    assert.equal(input('scissors'), 'accepted');
    assert.deepEqual(await session.done, { phase: 'complete', challenger: 'rock', opponent: 'scissors', outcome: 'challenger' });
});

test('both participant ordering and complete/draw outcomes settle and release controls lifetime', async () => {
    const cases = [
        { first: 'alice', challenger: 'rock', opponent: 'scissors', outcome: 'challenger' },
        { first: 'bob', challenger: 'rock', opponent: 'paper', outcome: 'opponent' },
        { first: 'bob', challenger: 'paper', opponent: 'paper', outcome: 'draw' },
    ] as const;
    for (const example of cases) {
        const { session, clock, input, changes } = game();
        input('accept');
        if (example.first === 'alice') {
            input(example.challenger, 'alice');
            input(example.opponent, 'bob');
        } else {
            input(example.opponent, 'bob');
            input(example.challenger, 'alice');
        }
        const result = await session.done;
        assert.deepEqual(result, { phase: 'complete', challenger: example.challenger,
            opponent: example.opponent, outcome: example.outcome });
        assert.equal(clock.pending.size, 0);
        assert.equal(input('rock', 'alice'), 'finished');
        session.shutdown();
        clock.advance(60_000);
        assert.equal(session.state, result);
        assert.equal(changes.length, 3);
    }
});

test('shutdown during either active phase settles, notifies cleanup, and cancels the timer', async () => {
    for (const accepted of [false, true]) {
        const { session, clock, input, changes } = game();
        if (accepted) input('accept');
        session.shutdown();
        const result = await session.done;
        assert.deepEqual(result, { phase: 'ended', reason: 'shutdown' });
        assert.equal(clock.pending.size, 0);
        const count = changes.length;
        session.shutdown();
        clock.advance(60_000);
        assert.equal(changes.length, count);
        assert.equal(session.state, result);
    }
});

test('transport failure terminates both active phases and releases the deadline', async () => {
    for (const accepted of [false, true]) {
        const { session, clock, input } = game();
        if (accepted) input('accept');
        session.fail();
        assert.deepEqual(await session.done, { phase: 'ended', reason: 'error' });
        assert.equal(clock.pending.size, 0);
    }
});
