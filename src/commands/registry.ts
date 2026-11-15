import { prefixCommands as botPrefixCommands, slashCommands as botSlashCommands } from './bot';
import { prefixCommands as utilityPrefixCommands, slashCommands as utilitySlashCommands } from './utility';
import { prefixCommands as channelPrefixCommands } from './channel-manager';
import { createLegacyCommands } from './legacy';
import type { GiveawayService } from '../features/giveaways/service';
import type { CommandRegistry, PrefixCommand, SlashCommand } from './types';

export function createCommandRegistry(
    prefix: readonly PrefixCommand[],
    slash: readonly SlashCommand[],
): CommandRegistry {
    const prefixLookup = new Map<string, PrefixCommand>();
    const slashLookup = new Map<string, SlashCommand>();
    for (const command of prefix) {
        for (const name of [command.name, ...command.aliases]) {
            const key = name.toLowerCase();
            if (!key || /\s/.test(key)) throw new Error(`Invalid prefix command name: ${name}`);
            if (prefixLookup.has(key)) throw new Error(`Duplicate prefix command name or alias: ${key}`);
            prefixLookup.set(key, command);
        }
    }
    for (const command of slash) {
        const key = command.name.toLowerCase();
        if (!key || /\s/.test(key)) throw new Error(`Invalid slash command name: ${command.name}`);
        if (command.data.toJSON().name !== command.name) {
            throw new Error(`Slash command metadata and payload disagree: ${command.name}`);
        }
        if (slashLookup.has(key)) throw new Error(`Duplicate slash command name: ${key}`);
        slashLookup.set(key, command);
    }
    return { prefix: [...prefix], slash: [...slash], prefixLookup, slashLookup };
}

export function createRuntimeRegistry(giveaways: GiveawayService | null): CommandRegistry {
    return createCommandRegistry(
        [...botPrefixCommands, ...utilityPrefixCommands, ...channelPrefixCommands, ...createLegacyCommands(giveaways)],
        [...botSlashCommands, ...utilitySlashCommands],
    );
}
