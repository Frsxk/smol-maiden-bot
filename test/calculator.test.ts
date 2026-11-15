import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { calculate, CalculatorInputError } from '../src/commands/utility/calculator';

function terminatedWorker(spy: { mock: { calls: readonly { this: unknown }[] } }): Worker {
    assert.equal(spy.mock.calls.length, 1);
    const worker = spy.mock.calls[0]?.this;
    assert.ok(worker instanceof Worker);
    assert.equal(worker.listenerCount('message'), 0);
    assert.equal(worker.listenerCount('error'), 0);
    assert.equal(worker.listenerCount('exit'), 0);
    return worker;
}

test('calculator preserves arithmetic normalization and the public examples', async () => {
    assert.deepEqual(await calculate('2,5 x 4 ÷ 2'), { operation: '2.5*4 / 2', result: '5' });
    assert.equal((await calculate('sqrt(3^2 + 4^2)')).result, '5');
    assert.equal((await calculate('2 inch to cm')).result, '5.08 cm');
    assert.ok(Math.abs(Number((await calculate('cos(45 deg)')).result) - Math.SQRT1_2) < 1e-15);
});

test('calculator preserves matrices, factorials, multi-argument functions and additional units', async () => {
    assert.equal((await calculate('[1,2;3,4] * [2;1]')).result, '[[4], [10]]');
    assert.equal((await calculate('5!')).result, '120');
    assert.equal((await calculate('max(2, 7, 4)')).result, '7');
    assert.equal((await calculate('exp(0)')).result, '1');
    assert.equal((await calculate('0x10 + 1')).result, '17');
    const area = (await calculate('1 acre to m^2')).result;
    assert.match(area, / m\^2$/);
    assert.ok(Math.abs(Number.parseFloat(area) - 4046.8564224) < 0.01);
    assert.equal((await calculate('a = 3; a^2')).result, '[9]');
});

test('calculator rejects invalid inputs with public errors', async () => {
    for (const expression of ['', ' '.repeat(501), '2 +', 'process.exit()', '1 / 0', 'sqrt', '`bad`', 'ones(20,20)']) {
        await assert.rejects(calculate(expression), CalculatorInputError);
    }
});

test('calculator worker paths do not depend on the working directory', async () => {
    const cwd = process.cwd();
    try {
        process.chdir(tmpdir());
        assert.equal((await calculate('6 * 7')).result, '42');
    } finally {
        process.chdir(cwd);
    }
});

test('successful calculations terminate workers and clear their timeout', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const terminate = context.mock.method(Worker.prototype, 'terminate');
    assert.equal((await calculate('6 * 7')).result, '42');
    terminatedWorker(terminate);
    context.mock.timers.tick(5_000);
    assert.equal(terminate.mock.calls.length, 1);
});

test('timeouts terminate workers without evaluating an expensive expression', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const terminate = context.mock.method(Worker.prototype, 'terminate');
    const calculation = calculate('1 + 1');
    const rejection = assert.rejects(calculation, error => error instanceof CalculatorInputError && /too long/.test(error.message));
    context.mock.timers.tick(5_000);
    await rejection;
    terminatedWorker(terminate);
});

test('worker errors are sanitized and terminate the worker', async context => {
    const once = context.mock.method(Worker.prototype, 'once');
    const terminate = context.mock.method(Worker.prototype, 'terminate');
    const calculation = calculate('1 + 1');
    const rejection = assert.rejects(calculation, error => error instanceof CalculatorInputError && !error.message.includes('private worker detail'));
    const worker = once.mock.calls.find(call => call.arguments[0] === 'message')?.this;
    assert.ok(worker instanceof Worker);
    assert.equal(worker.resourceLimits?.maxOldGenerationSizeMb, 64);
    assert.equal(worker.resourceLimits?.maxYoungGenerationSizeMb, 16);
    worker.emit('error', new Error('private worker detail'));
    await rejection;
    terminatedWorker(terminate);
});