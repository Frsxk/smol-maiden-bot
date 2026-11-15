import { AsyncLocalStorage } from 'node:async_hooks';

const channelLocks = new Map<string, Promise<void>>();
const lockContext = new AsyncLocalStorage<ReadonlySet<string>>();

// Re-entrancy lets a command hold the lock across fetch/read/modify/apply/save.
export function withChannelLock<T>(channelId: string, task: () => Promise<T>): Promise<T> {
    const held = lockContext.getStore();
    if (held?.has(channelId)) return task();

    const previous = channelLocks.get(channelId) ?? Promise.resolve();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const tail = previous.catch(() => {}).then(() => gate);
    channelLocks.set(channelId, tail);

    const run = previous.catch(() => {}).then(() => {
        const nextHeld = new Set(held);
        nextHeld.add(channelId);
        return lockContext.run(nextHeld, task);
    });

    return run.finally(() => {
        release();
        if (channelLocks.get(channelId) === tail) channelLocks.delete(channelId);
    });
}

// The caller must stop accepting commands before draining.
export async function drainChannelLocks(): Promise<void> {
    while (channelLocks.size > 0) {
        await Promise.all([...channelLocks.values()]);
    }
}
