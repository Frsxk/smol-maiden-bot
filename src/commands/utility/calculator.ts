import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

export const calculatorExamples = "That expression didn't work. Try something like:\n1. Square roots: `sqrt(3^2 + 4^2) = 5`\n2. Unit conversion: `2 inch to cm`\n3. Functions: `cos(45 deg) = 0.7071067811865476`\n4. Arithmetic (`+`, `-`, `^`, `/`, decimals): `2.5-2 = 0.5`";

export class CalculatorInputError extends Error {}

export interface Calculation {
    readonly operation: string;
    readonly result: string;
}

const timeoutMs = 5_000;
const maxOutputLength = 900;

function normalize(input: string): string {
    const operation = input.replace(/\b0x[\da-f]+\b|(?<=[\d)])\s*x\s*(?=[\d.(])/gi,
        match => /^0x/i.test(match) ? match : '*').replace(/÷/g, '/');
    // Commas inside calls and collections separate arguments, not decimal digits.
    return /[a-z_]\w*\s*\(|[\[{}]/i.test(operation)
        ? operation
        : operation.replace(/,/g, '.');
}

export async function calculate(input: string): Promise<Calculation> {
    if (!input.trim() || input.length > 500) throw new CalculatorInputError('Use an expression between 1 and 500 characters.');
    if (/[`\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)) throw new CalculatorInputError('That expression contains unsupported characters.');
    const operation = normalize(input);
    const { promise, resolve, reject } = Promise.withResolvers<Calculation>();
    let worker: Worker;
    try {
        const development = __filename.endsWith('.ts');
        worker = new Worker(join(__dirname, `calculator-worker.${development ? 'ts' : 'js'}`), {
            workerData: operation,
            // tsx's CommonJS hook loads first-party TS workers during development, independent of cwd.
            execArgv: development ? ['--require', require.resolve('tsx/cjs')] : [],
            resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        });
    } catch {
        throw new CalculatorInputError('That expression could not be calculated.');
    }
    let finished = false;
    const finish = (result?: string, message = 'That expression could not be calculated.'): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const settle = (): void => {
            worker.removeAllListeners();
            if (result === undefined) reject(new CalculatorInputError(message));
            else resolve({ operation, result });
        };
        void worker.terminate().then(settle, settle);
    };
    const timer = setTimeout(() => finish(undefined, 'That expression took too long to calculate.'), timeoutMs);
    worker.once('message', (value: unknown) => {
        if (typeof value === 'string' && value.length > 0 && value.length <= maxOutputLength && !/NaN|Infinity|```/.test(value)) finish(value);
        else finish(undefined, 'The result cannot be displayed. Use a smaller, finite calculation.');
    });
    worker.once('error', () => finish());
    worker.once('exit', () => finish());
    return promise;
}
