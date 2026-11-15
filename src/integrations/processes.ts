import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const resolveModule = createRequire(__filename).resolve;

export async function startProcess(executable: string, args: readonly string[]): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const child = spawn(executable, [...args], { shell: false, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('spawn', resolve);
    await promise;
}

export async function controlPm2(action: 'restart' | 'stop', processName: string): Promise<void> {
    let executable = 'pm2';
    let args = [action, processName];
    if (process.platform === 'win32') {
        const paths = [process.cwd(), dirname(process.execPath)];
        if (process.env['APPDATA']) paths.push(join(process.env['APPDATA'], 'npm'));
        if (process.env['npm_config_prefix']) paths.push(process.env['npm_config_prefix']);
        // Invoke the JavaScript CLI through Node, not the Windows pm2.cmd shell wrapper.
        executable = process.execPath;
        args = [resolveModule('pm2/bin/pm2', { paths }), ...args];
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    execFile(executable, args, { shell: false, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        if (error) reject(error);
        else resolve();
    });
    await promise;
}
