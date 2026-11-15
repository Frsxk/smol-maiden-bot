import { config as loadDotenv } from 'dotenv';
import { createApplication, describeRuntimeError, parseGiveawayLocations } from './app';
import type { Application, ApplicationOptions } from './app';
import { loadConfig } from './config';
import type { Environment } from './config';
import type { RuntimeLogger } from './events';

export function createConfiguredApplication(env: Environment, options: ApplicationOptions = {}): Application {
    const config = loadConfig(env);
    const legacyLocations = parseGiveawayLocations(env.GIVEAWAY_LOCATIONS_JSON);
    return createApplication(config, { ...options, legacyLocations });
}

export async function bootstrap(env: Environment = process.env, options: ApplicationOptions = {}): Promise<Application> {
    const application = createConfiguredApplication(env, options);
    await application.start();
    return application;
}

export function installProcessHandlers(application: Application, logger: RuntimeLogger = console): () => void {
    let stopping = false;
    function shutdown(fatal: boolean): void {
        if (fatal) process.exitCode = 1;
        if (stopping) return;
        stopping = true;
        const deadline = setTimeout(() => {
            logger.error('[Shutdown] Graceful shutdown exceeded its deadline. Forcing exit.');
            process.exit(1);
        }, 20000);
        void application.stop().then(() => {
            clearTimeout(deadline);
            remove();
            process.exit(process.exitCode ?? 0);
        }, error => {
            process.exitCode = 1;
            logger.error(`[Shutdown] ${describeRuntimeError(error)}. Waiting for the forced shutdown deadline.`);
        });
    }
    const signal = () => { shutdown(false); };
    const exception = (error: unknown) => {
        logger.error(`[Fatal] ${describeRuntimeError(error)}. Stopping safely; inspect bot permissions and configuration before restarting.`);
        shutdown(true);
    };
    process.on('SIGINT', signal);
    process.on('SIGTERM', signal);
    process.on('uncaughtException', exception);
    process.on('unhandledRejection', exception);
    function remove(): void {
        process.off('SIGINT', signal);
        process.off('SIGTERM', signal);
        process.off('uncaughtException', exception);
        process.off('unhandledRejection', exception);
    }
    return remove;
}

export async function main(): Promise<void> {
    loadDotenv();
    let removeHandlers: (() => void) | undefined;
    try {
        const application = createConfiguredApplication(process.env);
        removeHandlers = installProcessHandlers(application);
        await application.start();
    } catch (error) {
        removeHandlers?.();
        console.error(`[Startup] ${describeRuntimeError(error)}. Check TOKEN, enabled privileged intents, and MongoDB settings before restarting.`);
        process.exitCode = 1;
        setTimeout(() => { process.exit(1); }, 1000).unref();
    }
}

if (require.main === module) {
    void main().catch(error => {
        console.error(`[Startup] ${describeRuntimeError(error)}.`);
        process.exitCode = 1;
    });
}
