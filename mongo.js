const mongoose = require("mongoose");
const { MongoPath } = require("./config");
const chalk = require('chalk');

module.exports = async () => {
    await mongoose.connect(MongoPath, {
        useNewUrlParser: true,
        useUnifiedTopology: true,

    })
    return mongoose
}
mongoose.connection.on('connected', () => {
    console.log(chalk.bgBlueBright.black(` Successfully connected to MongoDB!`));
});