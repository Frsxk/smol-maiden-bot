import mongoose from 'mongoose';
import { OwnedChannel } from './owned-channel';

export async function connectDatabase(uri: string): Promise<void> {
    if (!uri) throw new Error('Set MONGODB to enable Channel Manager.');
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    // Claims depend on the unique indexes being ready before command dispatch.
    await OwnedChannel.init();
}

export async function disconnectDatabase(): Promise<void> {
    await mongoose.disconnect();
}
