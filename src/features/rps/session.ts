export type RpsChoice = 'rock' | 'paper' | 'scissors';
export type RpsOutcome = 'challenger' | 'opponent' | 'draw';
export type RpsAction = 'accept' | 'decline' | RpsChoice;
export type RpsEndReason = 'declined' | 'invitation-timeout' | 'choice-timeout' | 'shutdown' | 'error';

export interface RpsPlayers {
    readonly challenger: string;
    readonly opponent: string;
}

export type RpsState =
    | { readonly phase: 'invitation' }
    | { readonly phase: 'choosing'; readonly challenger: RpsChoice | null; readonly opponent: RpsChoice | null }
    | { readonly phase: 'complete'; readonly challenger: RpsChoice; readonly opponent: RpsChoice; readonly outcome: RpsOutcome }
    | { readonly phase: 'ended'; readonly reason: RpsEndReason };

export type RpsTerminal = Extract<RpsState, { phase: 'complete' | 'ended' }>;
export type RpsInputResult = 'accepted' | 'outsider' | 'invalid' | 'duplicate' | 'finished' | 'invited-only';

export interface RpsClock {
    schedule(milliseconds: number, callback: () => void): () => void;
}

const clock: RpsClock = {
    schedule(milliseconds, callback) {
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
    },
};

export function rpsOutcome(challenger: RpsChoice, opponent: RpsChoice): RpsOutcome {
    if (challenger === opponent) return 'draw';
    return (challenger === 'rock' && opponent === 'scissors')
        || (challenger === 'paper' && opponent === 'rock')
        || (challenger === 'scissors' && opponent === 'paper') ? 'challenger' : 'opponent';
}

function isAction(value: string): value is RpsAction {
    return value === 'accept' || value === 'decline' || value === 'rock' || value === 'paper' || value === 'scissors';
}

export function isRpsTerminal(state: RpsState): state is RpsTerminal {
    return state.phase === 'complete' || state.phase === 'ended';
}

export interface RpsSessionOptions {
    readonly clock?: RpsClock;
    readonly onChange?: (state: RpsState) => void;
}

export class RpsSession {
    private current: RpsState = { phase: 'invitation' };
    private cancelTimer: (() => void) | undefined;
    private readonly resolveDone: (state: RpsTerminal) => void;
    readonly done: Promise<RpsTerminal>;

    constructor(
        readonly id: string,
        readonly players: RpsPlayers,
        private readonly options: RpsSessionOptions = {},
    ) {
        if (!id || !players.challenger || !players.opponent || players.challenger === players.opponent) {
            throw new Error('An RPS session requires an ID and two distinct participants');
        }
        let resolveDone!: (state: RpsTerminal) => void;
        this.done = new Promise((resolve) => { resolveDone = resolve; });
        this.resolveDone = resolveDone;
        this.armTimeout('invitation-timeout');
    }

    get state(): RpsState { return this.current; }

    customId(action: RpsAction): string { return `rps:${this.id}:${action}`; }

    input(customId: string, userId: string): RpsInputResult {
        const prefix = `rps:${this.id}:`;
        if (!customId.startsWith(prefix)) return 'invalid';
        const action = customId.slice(prefix.length);
        if (!isAction(action)) return 'invalid';
        if (userId !== this.players.challenger && userId !== this.players.opponent) return 'outsider';
        if (isRpsTerminal(this.current)) return 'finished';
        if (this.current.phase === 'invitation') {
            if (userId !== this.players.opponent) return 'invited-only';
            if (action === 'accept') {
                this.current = { phase: 'choosing', challenger: null, opponent: null };
                this.armTimeout('choice-timeout');
                this.options.onChange?.(this.current);
                return 'accepted';
            }
            if (action === 'decline') {
                this.finish({ phase: 'ended', reason: 'declined' });
                return 'accepted';
            }
            return 'invalid';
        }
        if (action === 'accept' || action === 'decline') return 'invalid';
        const participant = userId === this.players.challenger ? 'challenger' : 'opponent';
        if (this.current[participant] !== null) return 'duplicate';
        const next = { ...this.current, [participant]: action };
        if (next.challenger !== null && next.opponent !== null) {
            this.finish({ phase: 'complete', challenger: next.challenger, opponent: next.opponent,
                outcome: rpsOutcome(next.challenger, next.opponent) });
        } else {
            this.current = next;
            this.options.onChange?.(next);
        }
        return 'accepted';
    }

    shutdown(): void { this.finish({ phase: 'ended', reason: 'shutdown' }); }
    fail(): void { this.finish({ phase: 'ended', reason: 'error' }); }

    private armTimeout(reason: 'invitation-timeout' | 'choice-timeout'): void {
        this.cancelTimer?.();
        this.cancelTimer = (this.options.clock ?? clock).schedule(30_000, () => {
            this.finish({ phase: 'ended', reason });
        });
    }

    private finish(state: RpsTerminal): void {
        if (isRpsTerminal(this.current)) return;
        this.current = state;
        this.cancelTimer?.();
        this.cancelTimer = undefined;
        this.resolveDone(state);
        this.options.onChange?.(state);
    }
}
