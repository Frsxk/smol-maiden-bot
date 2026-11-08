const mongoose = require('mongoose');
const { MongoPath } = require('./config');
const OwnedChannel = require('./models/OwnedChannel');

module.exports = async () => {
    if (!MongoPath) throw new Error('Set MONGODB to enable Channel Manager.');
    mongoose.set('strictQuery', true);
    await mongoose.connect(MongoPath, { serverSelectionTimeoutMS: 10000 });
    // Claims rely on unique indexes, so build them before accepting commands.
    await OwnedChannel.init();
    console.log('[MongoDB] Channel registry connected.');
    return mongoose;
};
