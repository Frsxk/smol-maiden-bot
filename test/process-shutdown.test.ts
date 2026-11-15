import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

for (const trigger of ['signal', 'exception', 'rejection', 'fatal-during-cleanup'] as const) {
    test(`process shutdown exits after deferred cleanup with retained handles: ${trigger}`, {
        skip: process.platform === 'win32' && (trigger === 'signal' || trigger === 'fatal-during-cleanup'),
    }, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'maiden-shutdown-'));
        const marker = join(directory, 'cleanup');
        const script = `
            const { appendFileSync } = require('node:fs');
            const { MessageChannel } = require('node:worker_threads');
            const { installProcessHandlers } = require(${JSON.stringify(require.resolve('../src/index'))});
            const trigger = ${JSON.stringify(trigger)};
            const marker = ${JSON.stringify(marker)};
            const retained = new MessageChannel();
            retained.port1.on('message', () => {});
            retained.port2.postMessage('keep the receiving port referenced');
            installProcessHandlers({
                async stop() {
                    appendFileSync(marker, 'started\\n');
                    if (trigger === 'fatal-during-cleanup') {
                        setImmediate(() => { throw new Error('fatal while stopping'); });
                    }
                    const cleanup = Promise.withResolvers();
                    setImmediate(cleanup.resolve);
                    await cleanup.promise;
                    appendFileSync(marker, 'completed\\n');
                }
            });
            setImmediate(() => {
                if (trigger === 'signal' || trigger === 'fatal-during-cleanup') process.kill(process.pid, 'SIGTERM');
                else if (trigger === 'exception') throw new Error('offline fatal exception');
                else void Promise.reject(new Error('offline fatal rejection'));
            });
        `;
        try {
            const { promise, resolve } = Promise.withResolvers<{ code: string | number | null; signal: NodeJS.Signals | null; stderr: string }>();
            execFile(process.execPath, ['-e', script], { timeout: 6_000, killSignal: 'SIGKILL', encoding: 'utf8' }, (error, _stdout, stderr) => {
                resolve({ code: error?.code ?? 0, signal: error?.signal ?? null, stderr });
            });
            const result = await promise;
            assert.equal(result.signal, null, result.stderr);
            assert.equal(result.code, trigger === 'signal' ? 0 : 1, result.stderr);
            assert.equal(await readFile(marker, 'utf8'), 'started\ncompleted\n');
            if (trigger !== 'signal') assert.match(result.stderr, /\[Fatal\]/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
}
