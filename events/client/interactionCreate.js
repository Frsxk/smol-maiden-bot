const simplydjs = require("simply-djs");

module.exports = {
    name: 'interactionCreate',

    /**
     * @param {CommandInteraction} interaction 
     * @param {Client} client 
     */
    async execute(interaction, client) {
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('role-')) {
                await simplydjs.manageBtnRole(interaction);
            } else if (['enter_giveaway', 'end_giveaway', 'reroll_giveaway'].includes(interaction.customId)) {
                await simplydjs.manageGiveaway(interaction);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;
        
        const command = client.slash.get(interaction.commandName);
        if (!command) return interaction.reply({ content: 'Unknown Error occurred.', ephemeral: true });
        
        if (command.ownerOnly) {
            if (interaction.user.id !== client.config.ownerID) {
                return interaction.reply({ content: "This command is only for Bot Owner!", ephemeral: true });
            }
        }

        const args = [];
        
        for (let option of interaction.options.data) {
            if (option.type === client.discord.ApplicationCommandOptionType.Subcommand) {
                if (option.name) args.push(option.name);
                option.options?.forEach(x => {
                    if (x.value) args.push(x.value);
                });
            } else if (option.value) args.push(option.value);
        }
        
        try {
            command.run(client, interaction, args)
        } catch (e) {
            interaction.reply({ content: e.message, ephemeral: true });
        }
    }
}
