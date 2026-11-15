import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags,
    type ColorResolvable, type EmbedFooterOptions, type Message, type MessageComponentInteraction,
} from 'discord.js';
import { isRpsTerminal, RpsSession, type RpsInputResult, type RpsState } from './session';

export { RpsSession, rpsOutcome, isRpsTerminal } from './session';
export type { RpsChoice, RpsClock, RpsState, RpsTerminal, RpsSessionOptions } from './session';

export interface RpsOptions {
    readonly color?: ColorResolvable;
    readonly footer?: EmbedFooterOptions;
    readonly registerCleanup?: (cleanup: () => void | Promise<void>) => void;
}

const responses: Record<RpsInputResult, string> = {
    accepted: 'Your response has been recorded.',
    outsider: 'You are not a participant in this game.',
    invalid: 'That control is not available for this game right now.',
    duplicate: 'You have already chosen. Wait for your opponent!',
    finished: 'This game has already ended.',
    'invited-only': 'Only the invited player can accept or decline.',
};

function description(session: RpsSession, state: RpsState): string {
    const challenger = `<@${session.players.challenger}>`;
    const opponent = `<@${session.players.opponent}>`;
    switch (state.phase) {
        case 'invitation':
            return `${opponent}, ${challenger} challenged you to Rock Paper Scissors!\nAccept or decline within 30 seconds.`;
        case 'choosing':
            return `${challenger} vs ${opponent}\nChoose rock, paper, or scissors within 30 seconds. Your choice stays secret until both players have chosen.\n${challenger}: ${state.challenger ? 'Ready' : 'Choosing'}\n${opponent}: ${state.opponent ? 'Ready' : 'Choosing'}`;
        case 'complete': {
            const result = state.outcome === 'draw' ? "It's a draw!" : `${state.outcome === 'challenger' ? challenger : opponent} wins!`;
            return `${challenger}: ${state.challenger}\n${opponent}: ${state.opponent}\n\n${result}`;
        }
        case 'ended':
            switch (state.reason) {
                case 'declined': return `${opponent} declined the challenge.`;
                case 'invitation-timeout': return `${opponent} did not respond in time. Challenge cancelled.`;
                case 'choice-timeout': return 'Time is up! Both players must choose within 30 seconds. Game cancelled.';
                case 'shutdown': return 'The bot is shutting down. Game cancelled.';
                case 'error': return 'The game could not continue. Please try again.';
            }
    }
}

function view(session: RpsSession, options: RpsOptions) {
    const state = session.state;
    const embed = new EmbedBuilder().setTitle('Rock Paper Scissors').setDescription(description(session, state));
    if (options.color !== undefined) embed.setColor(options.color);
    if (options.footer !== undefined) embed.setFooter(options.footer);
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (!isRpsTerminal(state)) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        if (state.phase === 'invitation') {
            row.addComponents(
                new ButtonBuilder().setCustomId(session.customId('accept')).setLabel('Accept').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(session.customId('decline')).setLabel('Decline').setStyle(ButtonStyle.Danger),
            );
        } else {
            for (const choice of ['rock', 'paper', 'scissors'] as const) {
                row.addComponents(new ButtonBuilder().setCustomId(session.customId(choice))
                    .setLabel(choice.charAt(0).toUpperCase() + choice.slice(1)).setStyle(ButtonStyle.Primary));
            }
        }
        components.push(row);
    }
    return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** Resolves after the game ends and its final message edit finishes, without logging in or owning the client. */
export async function playRps(message: Message<true>, options: RpsOptions = {}): Promise<void> {
    const opponent = message.mentions.users.first();
    if (!opponent || opponent.bot || opponent.id === message.author.id) {
        await message.reply({ content: !opponent ? 'Mention a user to play Rock Paper Scissors with!'
            : opponent.bot ? 'You cannot play Rock Paper Scissors with a bot!'
                : 'You cannot play Rock Paper Scissors with yourself!', allowedMentions: { repliedUser: false } });
        return;
    }

    let gameMessage: Message<true> | undefined;
    let stopCollector: (() => void) | undefined;
    let edits: Promise<void> = Promise.resolve();
    const session = new RpsSession(message.id, { challenger: message.author.id, opponent: opponent.id }, {
        onChange(state) {
            if (isRpsTerminal(state)) stopCollector?.();
            edits = edits.then(async () => {
                if (gameMessage) await gameMessage.edit(view(session, options));
            }).catch(() => { session.fail(); });
        },
    });
    const cleanup = async (): Promise<void> => {
        session.shutdown();
        stopCollector?.();
        await edits;
    };
    try {
        options.registerCleanup?.(cleanup);
        gameMessage = await message.reply(view(session, options));
        if (isRpsTerminal(session.state)) {
            await gameMessage.edit(view(session, options));
            return;
        }
        const collector = gameMessage.createMessageComponentCollector({ componentType: ComponentType.Button });
        stopCollector = () => {
            stopCollector = undefined;
            collector.stop('rps-finished');
        };
        const acknowledge = async (interaction: MessageComponentInteraction): Promise<void> => {
            try {
                const result = session.input(interaction.customId, interaction.user.id);
                await interaction.reply({ content: responses[result], flags: MessageFlags.Ephemeral });
            } catch {
                session.fail();
            }
        };
        collector.on('collect', (interaction) => { acknowledge(interaction).catch(() => { session.fail(); }); });
        collector.on('end', () => { session.fail(); });
        await session.done;
        await edits;
    } finally {
        await cleanup();
    }
}
