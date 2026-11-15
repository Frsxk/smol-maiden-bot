# Smol Maiden

<p align="center">
  <img src="./src/profile.jpg" alt="Smol Maiden's profile picture" width="200">
</p>

A small Discord.js bot for personal channels, utilities, and games. Made by [frisky](https://github.com/Frsxk), with a soft spot for pink. 🩷

Smol Maiden is open source under the [ISC license](./LICENSE). You can run your own instance or adapt the commands for your server.

## Requirements

- Node.js **22.12.0 or newer** and a compatible npm version. CI and Docker use Node 22.
- A Discord bot account.
- MongoDB for channel ownership and giveaways. Without `MONGODB`, both are unavailable; other commands can run.

Install the locked dependency graph with `npm ci`. First-party runtime code is strict TypeScript, compiled to CommonJS JavaScript in `dist/`; production does not need `tsx` or TypeScript installed.

## Run locally

```sh
git clone https://github.com/Frsxk/smol-maiden-bot.git
cd smol-maiden-bot
npm ci
cp .env.example .env
```

Canvas needs a compatible native binary or your platform's [build dependencies](https://github.com/Automattic/node-canvas#compiling). The Docker build supports a source-build fallback and includes Cairo/Pango/JPEG/GIF/SVG runtime libraries. Do not disable dependency install scripts: Canvas must install its native binding.

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**, enable **Server Members Intent** and **Message Content Intent**. These are privileged intents; larger/verified bots may need Discord approval. The client requests `Guilds`, `GuildMessages`, `MessageContent`, and `GuildMembers`, not Presence Intent.
3. Invite the bot using `bot` and `applications.commands`. Grant **View Channel**, **Send Messages**, **Read Message History**, **Embed Links**, and **Attach Files** as needed. Channel overwrites and role menus need **Manage Roles**; moving/creating channels needs **Manage Channels**. Pinning needs the bot's current **Pin Messages** permission and **Add Reactions** for its confirmation.
4. Edit `.env` using [`.env.example`](./.env.example). Set `TOKEN`, your application's `BOT_CLIENT_ID`, and your trusted operator's `OWNER_ID`. Keep the space in `BOT_PREFIX="sm "`. Configure the guild mappings below before moving an existing deployment.
5. Build and start:

   ```sh
   npm run build
   npm start
   ```

`npm run dev` watches `src/index.ts` with `tsx` and starts the actual bot. It needs the same configuration; it is not an offline check. When `MONGODB` is configured, startup waits for the database and indexes before login. A connection failure stops startup; later disconnection makes database-dependent commands fail promptly.

Only trusted operators should be bot owners. `sm run` executes a program inside the bot's runtime and sends its output to the console. It is not a sandbox. In Docker it runs inside the container, not on the host. Never mount the Docker socket for this feature.

### Slash command deployment

Startup and reconnects never register commands. Build first, then preview the complete payload without a token or network request:

```sh
npm run deploy:commands -- --guild 835368931300474911
```

Choose exactly one scope: `--guild <guild-id>` or `--global`. A missing scope is an error. `--apply` enables REST writes and requires an explicit `BOT_CLIENT_ID` and valid `TOKEN`; the CLI checks the token's application identity before writing.

**Applying bulk-overwrites that scope's commands, deleting definitions absent from this payload.** Before applying, back up the existing payload from Discord's application-command API (use the same application and scope) to protected operator storage. The CLI does not make that backup for you. Review the preview and stage in a disposable guild first:

```sh
npm run deploy:commands -- --guild 835368931300474911 --apply
# Only after guild acceptance and an explicit decision to replace global commands:
npm run deploy:commands -- --global --apply
```

These apply commands contact Discord. Offline migration acceptance has not run them.

## Run with Docker

Configure `.env` first. Build without starting or supplying a production token:

```sh
docker compose build
# Cut over only after the checks and backups below:
docker compose up -d
docker compose logs -f bot
docker compose stop bot
```

The multi-stage `node:22-slim` image installs dev dependencies to compile, installs production dependencies separately with `npm ci --omit=dev`, and ships only those dependencies and `dist/`. Its native Canvas/GIF build smoke uses a generated image, not Discord or a remote avatar. Compose injects `.env` at runtime, runs non-root with a read-only root filesystem and writable `/tmp` tmpfs, and preserves signal handling and restart limits. Recreate the container after changing `.env`.

There is no healthcheck: importing Discord.js cannot establish login or database readiness. Inspect startup logs and operator checks instead. PM2 is not installed in this image. Use `docker compose restart bot` or `docker compose stop bot`; an in-process clean exit under `unless-stopped` is not persistent shutdown.

Shutdown drains bot operations for up to 15 seconds, then exits after successful cleanup; a 20-second deadline forces exit if cleanup fails or hangs. Compose allows 25 seconds before SIGKILL so it does not interrupt that shutdown window. Keep any external supervisor's stop timeout above 20 seconds.

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

Queued ownership commands refresh the caller's membership and channel permissions after acquiring the channel lock. A revoked permission or failed lookup prevents the operation; permissions from the original message are not reused.

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
- `sm pin <message>` (`p`) / `sm unpin <message>` (`unp`): use an ID, same-channel message link, or reply in a regular text channel, announcement channel, or thread. The actor needs channel **Manage Messages**, **Administrator**, or bot-owner authorization. The bot needs **Pin Messages**.
- `sm pinscount` (`pc`): works in those message channels and counts the first page only (at most 50 pins), not the complete history. Only the bot owner can supply another channel.
- `sm create-channel <name>` (`createch`, `newch`): bot-owner-only; uses the configured category and does not claim ownership.
- `sm upgrade <#channel>` (`up`, `upg`): uses the configured category progression and required role. Channel access and permission checks still apply.

### Games and server-specific commands

- `sm turu @opponent`: rock-paper-scissors, with invitations, decline, timeout, win, and draw handling.
- `sm patthearifin` (`petthearifin`, `arifin`, `afn`): headpat GIF for `PET_USER_ID`.
- `sm gstart <duration> <winners> <prize>` (`ga`): owner-only giveaway creation; for example `1h 1 a cookie`.
- `sm 2iFTIvcy6`: owner-only posting of configured role menus.
- `sm 6nhEqa0jM3`: owner-only update of the configured bot-authored rules message.
- `sm resetpos [c|b|a]` (`rp`): owner-only reset of configured channel parents and positions.
- `sm echo` (`repeat`): owner-only plain or embed messages; see command help for destination syntax.
- `sm run <program> [arguments]` (`exec`, `execute`): owner-only process execution.
- `sm restart` (`rs`) / `sm shutdown` (`sd`): owner-only PM2 actions, enabled only with `PM2_PROCESS_NAME` and a working PM2 installation controlling that name. On Unix, `pm2` must be on the bot process's `PATH`; on Windows, the bot invokes the locally or globally installed PM2 JavaScript CLI through Node.
- `sm test`: the public original test reply.

### Guild configuration and old component messages

`GUILD_CONFIG_JSON` is an object keyed by guild ID. Its default is `{}`: there are no hidden fallback guild mappings. Missing capabilities respond without mutation. This is an operator-owned cutover requirement, not permission to disable the existing guild silently.

The complete previous Loli's Fantasy mapping is below. Verify all IDs and current role hierarchy, then encode the full object on one line as the value of `GUILD_CONFIG_JSON` in `.env`. A ready-to-copy commented assignment is also in `.env.example`. Other guilds need their own IDs.

```json
{
  "835368931300474911": {
    "createChannelCategoryId": "954368431329787924",
    "categoryProgression": [
      {"fromCategoryId":"954368431329787924","toCategoryId":"954368406839246908","requiredRoleId":"954370385334399027"},
      {"fromCategoryId":"954368406839246908","toCategoryId":"954368368037740564","requiredRoleId":"954370499050364939"},
      {"fromCategoryId":"954368368037740564","toCategoryId":"957508834434351114","requiredRoleId":"954370530969022494"}
    ],
    "levelRoleIds": {"1":"954370385334399027","2":"954370499050364939","3":"954370530969022494"},
    "roleMenus": [{
      "id":"levelling",
      "title":"Get your levelling role here!",
      "description":"Click a button below to get that role.\nlevel 1: category3 to category2\nlevel 2: category2 to category1\nlevel 3: category1 to category top",
      "footerText":"This only works while I'm online!",
      "buttons":[
        {"roleId":"954370385334399027","label":"level 1","style":"Secondary","emoji":"<:_1_:970602352006545450>"},
        {"roleId":"954370499050364939","label":"level 2","style":"Secondary","emoji":"<:_2_:970602352010747914>"},
        {"roleId":"954370530969022494","label":"level 3","style":"Secondary","emoji":"<:_3_:970602351868129291>"}
      ]
    }],
    "rulesDestination":{"channelId":"1041206376573177908","messageId":"1052407837344661524"},
    "resetPositions":[
      {"group":"c","channelId":"954368755872464926","categoryId":"954368431329787924","position":0},
      {"group":"c","channelId":"954368773090082846","categoryId":"954368431329787924","position":1},
      {"group":"c","channelId":"975759659526914058","categoryId":"954368431329787924","position":2},
      {"group":"b","channelId":"954368703351361557","categoryId":"954368406839246908","position":0},
      {"group":"b","channelId":"954368725207892119","categoryId":"954368406839246908","position":1},
      {"group":"b","channelId":"975759702292037734","categoryId":"954368406839246908","position":2},
      {"group":"a","channelId":"954368620996206592","categoryId":"954368368037740564","position":0},
      {"group":"a","channelId":"954368678865035284","categoryId":"954368368037740564","position":1},
      {"group":"a","channelId":"975759732474249286","categoryId":"954368368037740564","position":2}
    ]
  }
}
```

Existing `role-<roleId>` buttons remain routed, but their roles must appear in that guild's configured menus. Roles must be safe, unmanaged, and below the bot's highest role. Giveaway IDs `enter_giveaway`, `end_giveaway`, and `reroll_giveaway` remain supported. End/reroll requires **Administrator** or **Manage Events**; IDs alone never authorize an action.

Giveaways retain model `Giveaway-System` and collection `giveaway-systems`, including old entry and requirement fields. Additive fields record `guildId`, `channelId`, `completed`, `winners`, and `pendingPublish`. Old records have no location: set `GIVEAWAY_LOCATIONS_JSON` to a message-ID-to-location object, for example `{"MESSAGE_ID":{"guildId":"835368931300474911","channelId":"CHANNEL_ID"}}`, using actual numeric snowflakes. Inventory every active old message before cutover. The bot verifies original messages, resumes timers, completes overdue giveaways, and retries pending result publication on recovery without choosing new winners. Unmapped/inaccessible records are retained with diagnostics, not guessed by scanning channels. An interaction on a verified original message can recover its location, but is not a substitute for mapping all active timers.

Other settings are listed in `.env.example`: `BLOCKED_CHANNEL_IDS`/`BLOCKED_USER_IDS` are JSON arrays, `PET_USER_ID` controls the GIF target, and `EMBED_COLOR`/footer variables preserve the pink replies. Empty arrays explicitly clear the original block lists.

## Development and checks

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Tests compile into `.test-dist/` and use Node's test runner with offline Discord/database boundaries. Migration verification passed strict compilation, type-aware lint, all 141 tests, and the production build. The Node 22 image passed native Canvas/GIF, calculator worker, startup-failure, preview, and signal-cleanup checks under non-root/read-only restrictions. Disposable MongoDB checks covered indexes and old-document compatibility. No production login, command deployment, or production database migration was performed; live guild acceptance still requires operator approval.

Post-review checks passed for queued permission revocation, announcement/thread pin utilities, overlapping avatar clicks, and shutdown with retained handles, alongside TypeScript compilation, affected-file lint, and the production build. Unix signal and PM2 argument/error handling tests ran in an offline Node 22 container using a temporary PM2 executable, not a live PM2 daemon.

The calculator shares mathjs evaluation behind bounded expressions/output and a per-request worker with a five-second deadline and 64 MB old-generation heap limit. Development preloads `tsx/cjs`; production resolves the emitted sibling `calculator-worker.js` relative to the module, not the working directory. Ship all of `dist/`, including worker artifacts.

## Deployment and rollback

1. Obtain operator approval for live staging. Offline acceptance does not prove Discord permissions, role hierarchy, real MongoDB indexes, or login behavior. Test with a non-admin development-guild account.
2. Save the old image/artifact, configuration, current slash payload, protected database backup, and Discord permission-overwrite snapshots. Check restore access. Inventory legacy giveaways and apply the explicit guild/location mappings above.
3. Build the new image. Stop the old instance and drain its operations before starting the new one. Locks/queues are in-process: run exactly one process per token/database, never a rolling overlap.
4. Stage commands guild-first, review any bulk overwrite, and apply only with explicit approval. Start the new image and inspect database/login/recovery logs and representative commands.
5. To roll back, stop the new instance first, restore the old artifact/configuration, and explicitly restore changed slash payloads. Additive database fields do not require dropping existing records; do not overwrite legitimate new ownership writes with an old dump blindly.
6. Reverting code or MongoDB cannot automatically undo Discord permission changes. Reconcile failed permission rollbacks from snapshots. The old giveaway helper had broken recovery/timer behavior: reconcile active/completed/pending-publication records explicitly before returning to it, rather than assuming old code can resume them correctly.

## Dependencies and known limits

- Discord.js [14.28.1](https://github.com/discordjs/discord.js/releases/tag/14.28.1) supplies the client/builders; Mongoose stores ownership and giveaways.
- mathjs handles expressions. Its runtime result is validated at the integration boundary.
- pet-pet-gif uses Canvas; keep the direct `canvas` dependency and override because the package imports Canvas through its legacy dependency graph.
- RPS, role menus, and giveaways now use original TypeScript implementations. The licensed vendored RPS helper and unsupported simply-djs dependency are removed, not translated or copied.
- Obsolete chalk, node-cron, wait, nodemon, quickmongo, and direct mongodb dependencies are removed. Do not infer a clean audit from that list; advisory status needs its own current check.
- dotenv 10 ships declarations outside its exports map; the TypeScript configuration resolves that shipped declaration explicitly. Runtime still uses the locked dotenv version.

Keep `.env`, database dumps, and tokens out of Git. If a credential is exposed, rotate it; deleting the file or rewriting Git history does not revoke it. This public repository starts with a separate history from the old private deployment.

## Credits and contact

Smol Maiden began with [Expectatives' Discord.js v13 example](https://github.com/Expectatives/Discord.js-v13-Example/). Earlier versions used simply-djs game/role helpers; the current replacements are independent implementations, not ISC relicensing of that code. Profile art is credited to [@kudukimii](https://twitter.com/kudukimii); the software license does not grant separate rights to that artwork.

Report bugs through [GitHub issues](https://github.com/Frsxk/smol-maiden-bot/issues) or join the [support server](https://discord.gg/2SatpX28ZX). You can also find frisky on Discord as `@frxskie`.
