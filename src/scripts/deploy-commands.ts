import { REST, Routes } from 'discord.js';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { config as loadDotenv } from 'dotenv';
import { slashCommands as botCommands } from '../commands/bot';
import { slashCommands as utilityCommands } from '../commands/utility';
import type { SlashCommand } from '../commands/types';
import type { Environment } from '../config';

export interface DeploymentArguments {
    readonly scope: { readonly kind: 'global' } | { readonly kind: 'guild'; readonly guildId: string };
    readonly apply: boolean;
}

export function parseDeploymentArguments(args: readonly string[]): DeploymentArguments {
    let scope: DeploymentArguments['scope'] | undefined;
    let apply = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--apply') {
            if (apply) throw new Error('Specify --apply only once.');
            apply = true;
        } else if (arg === '--global') {
            if (scope) throw new Error('Choose exactly one deployment scope: --guild <id> or --global.');
            scope = { kind: 'global' };
        } else if (arg === '--guild') {
            if (scope) throw new Error('Choose exactly one deployment scope: --guild <id> or --global.');
            const guildId = args[++index];
            if (!guildId || !/^\d{17,20}$/.test(guildId)) throw new Error('--guild requires a Discord guild ID.');
            scope = { kind: 'guild', guildId };
        } else throw new Error(`Unknown deployment argument: ${arg ?? ''}`);
    }
    if (!scope) throw new Error('An explicit scope is required: --guild <id> or --global. Add --apply to write; otherwise this is a preview.');
    return { scope, apply };
}

export function buildCommandPayload(commands: readonly SlashCommand[]): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    const names = new Set<string>();
    return commands.map(command => {
        const payload = command.data.toJSON();
        if (payload.name !== command.name || !/^[a-z0-9_-]{1,32}$/.test(payload.name)) {
            throw new Error('Slash command payload name must match its canonical lowercase metadata name.');
        }
        if (names.has(payload.name)) throw new Error(`Duplicate slash command: ${payload.name}`);
        names.add(payload.name);
        return payload;
    });
}

export interface DeploymentRest {
    get(route: `/${string}`): Promise<unknown>;
    put(route: `/${string}`, options: { body: RESTPostAPIChatInputApplicationCommandsJSONBody[] }): Promise<unknown>;
}

export interface DeploymentDependencies {
    readonly commands?: readonly SlashCommand[];
    readonly output?: (message: string) => void;
    readonly createRest?: (token: string) => DeploymentRest;
}

export async function deployCommands(args: readonly string[], env: Environment, dependencies: DeploymentDependencies = {}): Promise<void> {
    const options = parseDeploymentArguments(args);
    const payload = buildCommandPayload(dependencies.commands ?? [...botCommands, ...utilityCommands]);
    const output = dependencies.output ?? console.log;
    const scope = options.scope.kind === 'global' ? 'global' : `guild ${options.scope.guildId}`;
    if (!options.apply) {
        output(JSON.stringify({ mode: 'preview', scope, commands: payload }, null, 2));
        return;
    }
    const token = env.TOKEN?.trim();
    if (!token || /\s/.test(token) || /^(?:your[-_ ]|replace[-_ ]|changeme|example|placeholder|token$)/i.test(token)) {
        throw new Error('Set TOKEN to a real bot token before applying a deployment.');
    }
    const applicationId = env.BOT_CLIENT_ID;
    if (!applicationId || !/^\d{17,20}$/.test(applicationId)) {
        throw new Error('Set BOT_CLIENT_ID explicitly to the application ID before applying a deployment.');
    }
    const rest = dependencies.createRest?.(token) ?? new REST({ version: '10' }).setToken(token);
    const identity = await rest.get(Routes.oauth2CurrentApplication());
    if (!identity || typeof identity !== 'object' || Reflect.get(identity, 'id') !== applicationId) {
        throw new Error('TOKEN belongs to a different application than BOT_CLIENT_ID. No commands were changed.');
    }
    const route = options.scope.kind === 'global'
        ? Routes.applicationCommands(applicationId)
        : Routes.applicationGuildCommands(applicationId, options.scope.guildId);
    await rest.put(route, { body: payload });
    output(`Replaced ${scope} commands with ${payload.length} commands for application ${applicationId}.`);
}

export async function main(): Promise<void> {
    loadDotenv();
    try { await deployCommands(process.argv.slice(2), process.env); }
    catch (error) {
        const message = error instanceof Error && /^(?:Specify |Choose |--guild |Unknown deployment argument: --[\w-]+$|An explicit scope |Set TOKEN |Set BOT_CLIENT_ID |TOKEN belongs |Slash command |Duplicate slash command: [\w-]+$)/.test(error.message)
            ? error.message : 'Deployment failed. Check the token, application ID, permissions, and Discord connectivity. No automatic retry was attempted.';
        console.error(`[Deploy] ${message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    void main().catch(() => {
        console.error('[Deploy] Deployment failed. Check environment configuration before restarting.');
        process.exitCode = 1;
    });
}
