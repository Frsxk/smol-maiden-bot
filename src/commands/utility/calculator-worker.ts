import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

interface MathRuntime {
    evaluate(expression: string): unknown;
    format(value: unknown, options: { precision: number }): string;
}

function isMathRuntime(value: unknown): value is MathRuntime {
    return typeof value === 'object' && value !== null
        && 'evaluate' in value && typeof value.evaluate === 'function'
        && 'format' in value && typeof value.format === 'function';
}

if (parentPort === null) throw new Error('Calculator workers require a parent port.');

try {
    // mathjs 10's published declarations conflict with NodeNext; validate only the runtime API used here.
    const math: unknown = createRequire(__filename)('mathjs');
    const expression: unknown = workerData;
    if (!isMathRuntime(math) || typeof expression !== 'string' || expression.length > 500) throw new Error('Invalid calculator request.');
    const value = math.evaluate(expression);
    if (value === undefined || typeof value === 'function') throw new Error('Not a calculation result.');
    const result = math.format(value, { precision: 16 });
    if (typeof result !== 'string' || result.length === 0 || result.length > 900 || /NaN|Infinity|```/.test(result)) {
        parentPort.postMessage(null);
    } else {
        parentPort.postMessage(result);
    }
} catch {
    parentPort.postMessage(null);
}
