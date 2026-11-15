import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';

for (const action of ['restart', 'stop'] as const) {
    test(`Unix PATH PM2 executable preserves arguments and ${action === 'restart' ? 'succeeds' : 'propagates failure'}`, {
        skip: process.platform === 'win32',
    }, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'maiden-pm2-'));
        const executable = join(directory, 'pm2');
        const processName = 'offline bot; $(not-a-command) "quoted"';
        try {
            await writeFile(executable, `#!/usr/bin/env node
process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');
process.stderr.write('offline PM2 stderr\\n');
if (process.argv[2] === 'stop') process.exitCode = 7;
`);
            await chmod(executable, 0o755);
            const script = `
                const { controlPm2 } = require(${JSON.stringify(require.resolve('../src/integrations/processes'))});
                void controlPm2(${JSON.stringify(action)}, ${JSON.stringify(processName)}).catch(error => {
                    console.error('PM2 failure code:', error.code);
                    process.exitCode = 1;
                });
            `;
            const { promise, resolve } = Promise.withResolvers<{ code: string | number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>();
            execFile(process.execPath, ['-e', script], {
                env: { ...process.env, PATH: `${directory}${delimiter}${dirname(process.execPath)}` },
                timeout: 6_000,
                killSignal: 'SIGKILL',
                encoding: 'utf8',
            }, (error, stdout, stderr) => {
                resolve({ code: error?.code ?? 0, signal: error?.signal ?? null, stdout, stderr });
            });
            const result = await promise;
            assert.equal(result.signal, null, result.stderr);
            assert.equal(result.code, action === 'restart' ? 0 : 1, result.stderr);
            assert.deepEqual(JSON.parse(result.stdout.trim()), [action, processName]);
            assert.match(result.stderr, /offline PM2 stderr/);
            if (action === 'stop') assert.match(result.stderr, /PM2 failure code: 7/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
}
