import type {
    ChatInputCommandInteraction,
    Client,
    Message,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    SlashCommandBuilder,
} from 'discord.js';
import type { BotConfig } from '../config';

export interface CommandMetadata {
    readonly name: string;
    readonly usage: string;
    readonly category: string;
    readonly description: string;
    readonly ownerOnly: boolean;
}

export interface PrefixCommand extends CommandMetadata {
    readonly aliases: readonly string[];
    execute(context: AppContext, message: Message<true>, args: readonly string[]): Promise<void>;
}

export interface SlashCommand extends CommandMetadata {
    readonly data: SlashCommandBuilder | {
        toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
    };
    execute(context: AppContext, interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface CommandRegistry {
    readonly prefix: readonly PrefixCommand[];
    readonly slash: readonly SlashCommand[];
    readonly prefixLookup: ReadonlyMap<string, PrefixCommand>;
    readonly slashLookup: ReadonlyMap<string, SlashCommand>;
}

export interface AppLifecycle {
    track<T>(promise: Promise<T>): Promise<T>;
    registerCleanup(cleanup: () => void | Promise<void>): () => void;
}

export interface AppContext {
    readonly client: Client;
    readonly config: BotConfig;
    readonly registry: CommandRegistry;
    readonly lifecycle: AppLifecycle;
}
