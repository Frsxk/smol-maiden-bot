# Smol Maiden

<p align="center">
  <img src="./src/profile.jpg" alt="Smol Maiden's profile picture" width="200">
</p>

A small Discord.js bot for personal channels, utilities, and games. Made by [frisky](https://github.com/Frsxk), with a soft spot for pink. 🩷

Smol Maiden is open source under the [ISC license](./LICENSE). You can run your own instance or adapt the commands for your server.

## Requirements

- Node.js 22 or newer and npm. The Docker image uses Node.js 22.
- A Discord bot account.
- MongoDB for Channel Manager. Without `MONGODB`, the bot starts with those commands disabled.

The project uses the versions in `package-lock.json`; install them with `npm ci`.

## Run locally

```sh
git clone https://github.com/Frsxk/smol-maiden-bot.git
cd smol-maiden-bot
npm ci
cp .env.example .env
```

If your npm version blocks dependency install scripts, approve the pinned `canvas` entry before rebuilding it:

```sh
npm approve-scripts canvas
npm rebuild canvas
```

Older npm versions run that install script during `npm ci`. Canvas may need your platform's native build dependencies if a prebuilt binary is unavailable.

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**, enable **Server Members Intent**, **Presence Intent**, and **Message Content Intent**. The current client requests all three.
3. Invite the bot using the `bot` and `applications.commands` scopes. Give it the permissions needed for the commands you plan to use. Channel Manager needs **View Channel**, **Send Messages**, and **Manage Roles** to edit channel permission overwrites. Embed replies also need **Embed Links**.
4. Put your token in `.env`. Add `MONGODB` if you want Channel Manager:

   ```dotenv
   TOKEN=your-bot-token-here
   MONGODB=
   ```

5. Edit `config.js`: set `botClientID` to your application ID and `ownerID` to your Discord user ID. You can also change the prefix, embed colour, and footers.

   Only trusted operators should be bot owners. `sm run` executes a program inside the bot's runtime. In Docker, that means inside the container, not on the host.

6. Start the bot:

   ```sh
   npm start
   ```

When `MONGODB` is set, startup waits for the database and ownership indexes before logging in to Discord. A failed connection stops startup. If MongoDB disconnects later, Channel Manager replies that the registry is unavailable instead of buffering commands.

The bot registers its slash commands globally at startup. Use a separate application for development if you do not want to overwrite your production application's command list.

## Run with Docker

Configure `.env` and `config.js` first, then run:

```sh
docker compose up --build -d
docker compose logs -f bot
docker compose down
```

Compose reads `.env` at runtime. The Docker build excludes it, and the container runs as a non-root user with a read-only root filesystem. After changing `.env`, recreate the container so it receives the new values.

The image's healthcheck only tests whether it can load Discord.js. It does **not** prove that the bot is logged in or that MongoDB is connected; check the startup logs for both.

## Personal channels

Run these commands inside the channel you want to manage. Ownership is stored by user and channel ID, so renaming a channel does not change its owner.

- `sm claim` registers the current text channel. You need **Manage Channels in that channel**, and it must not already belong to someone else. Each user can own one channel across all servers served by the same database. Threads and voice channels cannot be claimed.
- `sm lock` hides the channel from ordinary members, including those with existing role or member view allows. The channel owner, bot, and whitelisted members keep access.
- `sm unlock` restores the channel's previous view permissions. It does not make a previously private channel public. Blacklisted members remain denied.
- `sm whitelist add <user>` lets a member see the channel while it is locked.
- `sm whitelist remove <user>` removes that exception.
- `sm blacklist add <user>` denies a member access whether the channel is locked or unlocked. It also removes that member from the whitelist.
- `sm blacklist remove <user>` removes the blacklist restriction. It does not whitelist the member or override the channel's other access rules.

The channel owner, server administrators, and configured bot owner can run the four management commands. Claiming still requires the caller's **Manage Channels** permission. `create-channel` remains bot-owner-only; it does not assign ownership automatically.

For `<user>`, use a mention, user ID, or exact Discord username. Matching ignores case and does not use display names or server nicknames. Adding someone requires current server membership. After they leave, you can still remove them by ID or mention.

Blacklist takes precedence over whitelist. Remove a member from the blacklist before adding them to the whitelist again. Discord administrators and the server owner bypass channel overwrites, so they cannot be hidden or blacklisted. The bot and channel owner are also protected from blacklisting.

Permission updates preserve unrelated allow/deny bits. If saving the state fails after a Discord update, the bot attempts to restore the previous overwrites. If that rollback also fails, the reply asks an operator to inspect the permissions. Run one bot process per token and database; the command queue does not coordinate multiple instances, and Discord and MongoDB do not share a transaction. Do not edit view permissions manually while a channel is locked if you expect those edits to survive its later unlock.

## Command reference

The default prefix is `sm `, including the space. `sm help <command>` shows a command's description and usage.

### Utilities

- `sm help [command]` (`h`, `commands`): command help.
- `sm info` (`i`, `information`): bot and owner information.
- `sm list` (`cmd`, `ls`): list commands by category.
- `sm ping` (`pong`, `latency`): bot latency.
- `sm avatar [user]` (`av`, `profile`, `pfp`): user and server avatars.
- `sm calc <expression>` (`calculate`, `c`): evaluate an expression with mathjs.
- `sm time <format> [message]`: turn a message timestamp into Discord timestamp markup. See the command help for accepted formats.

Slash commands: `/help`, `/ping`, `/calc`.

### Channel controls

- `sm claim`: register ownership.
- `sm lock` (`l`) / `sm unlock` (`ul`): change channel visibility.
- `sm whitelist add/remove <user>` (`wl`, `invite`): manage locked-channel exceptions.
- `sm blacklist add/remove <user>` (`bl`, `uninvite`): manage access restrictions.
- `sm pin <message>` (`p`) / `sm unpin <message>` (`unp`): pin or unpin messages, subject to the command's permission checks.
- `sm pinscount` (`pc`): count fetched pins. The legacy command does not yet follow pagination.
- `sm upgrade`: the original server's category-upgrade helper.

### Games and server-specific commands

`sm turu` starts the local rock-paper-scissors module. `sm patthearifin` generates a headpat GIF for a fixed user. The owner-only `sm gstart` command uses simply-djs for giveaways.

Several older commands still contain the original server's channel, category, role, or message IDs. Review `create-ch.js`, `upgrade.js`, `resetpos.js`, and the rules/button-role commands before using them on another server. They are not configurable server-management features yet.

Other owner-only commands include `sm create-channel`, `sm echo`, `sm run`, `sm restart`, and `sm shutdown`. Restart and shutdown call PM2; the supplied Docker image does not include PM2.

## Development and checks

```sh
npm test
npm run dev
```

`npm test` runs the Channel Manager regression suite with fake Discord and MongoDB boundaries and real Discord.js permission flags. It does not log in to Discord or connect to a database. `npm run dev` starts the actual bot under nodemon and needs your local configuration.

After changing channel permissions, test with a non-admin account in a development server. An administrator account cannot verify that a channel is hidden.

## Dependencies and known limits

- Discord.js provides the Discord client and builders.
- Mongoose stores channel ownership and saved view-permission baselines.
- mathjs handles calculator expressions.
- pet-pet-gif uses Canvas for GIF generation. Keep the direct `canvas` dependency and override; the package imports Canvas without declaring it directly.
- simply-djs supports some legacy game and role flows. npm marks version 4.1.1 as unsupported. This release keeps it for compatibility; it does not replace that library or certify every legacy command.
- The remaining npm audit findings concern node-cron 3's transitive uuid dependency ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)). npm proposes a node-cron major upgrade; that migration is outside this release. Run `npm audit` to check the current advisory state.

Keep `.env`, database dumps, and tokens out of Git. If a credential is exposed, rotate it; deleting the file or rewriting Git history does not revoke it. This public repository starts with a separate history from the old private deployment.

## Credits and contact

Smol Maiden began with [Expectatives' Discord.js v13 example](https://github.com/Expectatives/Discord.js-v13-Example/). The local RPS module is adapted from simply-djs. Profile art is credited to [@kudukimii](https://twitter.com/kudukimii); the software license does not grant separate rights to that artwork.

Report bugs through [GitHub issues](https://github.com/Frsxk/smol-maiden-bot/issues) or join the [support server](https://discord.gg/2SatpX28ZX). You can also find frisky on Discord as `@frxskie`.
