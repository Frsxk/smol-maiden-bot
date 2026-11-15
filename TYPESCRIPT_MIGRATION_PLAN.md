# TypeScript and Discord.js refactoring plan

Status: proposed implementation plan. No runtime changes have been made.

## Goal and scope

Convert all first-party runtime code and tests to strict TypeScript, retain existing command behavior and MongoDB data, and make Discord event handling, authorization, configuration, and deployment explicit.

This is not a Discord.js v13-to-v14 upgrade: the lockfile already resolves Discord.js **14.27.0**. The work is a typed architecture migration and a review of legacy API usage.

Defaults for implementation:

- Keep existing prefix commands, aliases, and `/help`, `/ping`, `/calc`. Prefer slash commands for future additions, but do not remove prefix functionality or silently expand this migration into a slash-command redesign.
- Keep CommonJS output initially. TypeScript does not require an ESM conversion, and existing dependencies and tests use CommonJS.
- Keep npm, the lockfile, Node's test runner, MongoDB, and Mongoose. Do not combine the migration with unrelated dependency-major upgrades.
- Keep one bot process per token/database. Do not add sharding, Redis, a queue service, a web dashboard, or a dependency-injection framework.
- Preserve the bot's wording and visual identity except where a response is incorrect, unsafe, or describes obsolete behavior.
- Finish with one TypeScript implementation, not parallel JavaScript/TypeScript trees or compatibility exports.

## Repository findings

| Area | Evidence | Migration consequence |
| --- | --- | --- |
| Runtime | [package.json](package.json), [index.js](index.js) | CommonJS, no TypeScript toolchain; the client receives untyped `discord`, `config`, `cwd`, `commands`, and `slash` properties. |
| Registration | [handler/index.js](handler/index.js) | Filesystem discovery depends on the working directory. Global slash commands are overwritten on `clientReady`. |
| Dispatch | [events/client/interactionCreate.js](events/client/interactionCreate.js), [events/client/messageCreate.js](events/client/messageCreate.js) | Slash execution is not awaited inside `try/catch`; prefix execution has no dispatch-level error boundary. Option flattening drops falsy values. |
| Help | [slashCmds/Bot/help.js](slashCmds/Bot/help.js), [commands/Bot/help.js](commands/Bot/help.js), [commands/Bot/list.js](commands/Bot/list.js) | Help scans source directories at request time. Alias entries affect counts, and slash usage contains deployment-specific command IDs. |
| Ownership | [models/OwnedChannel.js](models/OwnedChannel.js), [utils/channelPermissions.js](utils/channelPermissions.js) | Unique user/channel indexes, stored permission baselines, a re-entrant per-channel queue, and compensating rollback are established contracts. |
| Database startup | [mongo.js](mongo.js), [index.js](index.js) | Missing `MONGODB` disables Channel Manager; configured MongoDB must connect and build indexes before login. |
| Tests | [test/channel-manager.test.js](test/channel-manager.test.js) | Substantial Channel Manager regression coverage uses real Discord.js permission flags and a model double installed through `require.cache`. |
| Games and roles | [src/rps.js](src/rps.js), [commands/lmao/gstart.js](commands/lmao/gstart.js), [commands/lmao/2iFTIvcy6.js](commands/lmao/2iFTIvcy6.js) | RPS is vendored generated JavaScript; role/giveaway flows use unsupported `simply-djs`. Existing component messages need a cutover strategy. |
| Operations | [commands/lmao/run.js](commands/lmao/run.js), [commands/lmao/restart.js](commands/lmao/restart.js), [commands/lmao/shutdown.js](commands/lmao/shutdown.js) | Owner-only process execution is intentionally available. Restart/shutdown call PM2, which the supplied container does not include. |
| Deployment | [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml) | Node 22, production dependency install, raw-source copies, non-root/read-only runtime. The healthcheck only imports Discord.js. |

### Version policy

Use the existing locked dependency graph for the first conversion and pin the compiler/tooling versions selected during implementation. Match `@types/node`, local development, CI, and Docker to the same tested Node major.

Keep the current Node 22 deployment baseline unless a verified dependency/toolchain requirement forces a coordinated upgrade. Check the entire dependency graph, not just Discord.js.

There is a documentation discrepancy worth recording: the Discord.js 14.27.0 web landing page currently advertises Node 24.17+, while its published npm manifest and this repository's lockfile declare `node >=18`. Use the exact package metadata and a clean install/build/runtime check to settle compatibility; do not silently upgrade production based on the landing page alone. The manifest's minimum is not a recommendation to deploy an obsolete Node release.

## Target architecture

Use ordinary modules and explicit dependencies. The following paths are proposed, not existing files:

```text
src/
  index.ts                    # Entry point and fatal-startup boundary
  app.ts                      # Client construction, startup, shutdown
  config.ts                   # Validated environment and server configuration
  commands/
    types.ts                  # Prefix/slash command contracts
    registry.ts               # Explicit imports, names, aliases, metadata
    bot/                      # Help, info, list, ping
    utility/                  # Avatar, calculator, timestamps
    channel-manager/          # Ownership, access controls, pins, categories
    legacy/                   # Existing server-specific and operator commands
  events/                     # Typed Discord event handlers
  components/                 # Persistent role/giveaway interaction routing
  features/
    channel-manager/          # Ownership policy, overwrite planning/application
    rps/                      # Typed game state and message collectors
  database/
    connection.ts
    owned-channel.ts          # Existing model and collection identity
  integrations/               # Narrow boundaries for retained external helpers
  scripts/
    deploy-commands.ts        # REST-only registration; no gateway login
  profile.jpg                 # Preserve README asset path
 test/                        # Migrated Node test-runner tests and fixtures
```

The `test/` directory is a repository-root sibling of `src/`.

### Type and module contracts

- Use `module: NodeNext` and `moduleResolution: NodeNext` with the existing `type: commonjs`. Set an explicit supported language target rather than inheriting NodeNext's floating target. Author TypeScript imports/exports and let the compiler emit CommonJS; do not enable `verbatimModuleSyntax` in this configuration.
- Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, and `noEmitOnError`. Finish with `allowJs: false` and no blanket `any`, `@ts-ignore`, or `@ts-nocheck` escapes.
- Separate a whole-project typecheck configuration from the production build configuration. Production emits only `src/` into `dist/`; tests compile to a separate ignored output directory and run with `node --test`.
- Define separate prefix and slash command contracts. Prefix handlers receive narrowed guild messages and parsed strings; slash handlers receive `ChatInputCommandInteraction` and use named option getters. Do not build a fake message/interaction union with casts.
- Use a small explicitly passed application context for configuration, registries, and required services. Import Discord.js symbols directly instead of attaching the package namespace to the client.
- Type event arguments with Discord.js `ClientEvents` and names with `Events`. Register `once` events once and catch rejected event-handler promises at the registration boundary.
- Keep canonical commands separate from alias lookup entries. Reject duplicate names/aliases during construction; derive help and counts from canonical metadata.
- Use string snowflakes, `bigint` permission bits, `OverwriteType`, and a `-1 | 0 | 1` view-state type. Model operation outcomes as discriminated unions so rollback failures cannot be mistaken for success.
- Narrow `unknown` errors and external values at boundaries. Add precise local declarations only where a dependency truly lacks usable types, backed by inspection of its actual API.

## Implementation phases

Each phase should be a reviewable change. Internal migration commits may be non-release candidates; deploy only after the final acceptance gate. Do not leave duplicate source trees to make an intermediate commit appear runnable.

### 1. Establish the baseline and compatibility contract

- Inventory all commands listed below, including aliases, argument formats, owner-only rules, guild restrictions, persistent component IDs, and external dependencies.
- Record the existing command payloads and database schema/index definitions before changing them. Use sanitized fixtures, not production tokens or database dumps in Git.
- Run the current Channel Manager suite once before implementation and record its result. Existing failures must be distinguished from migration regressions, not assumed absent.
- Confirm a supported Node patch, installed dependency compatibility, and Canvas availability on the development platform and Linux image.
- Record the expected behavior of currently broken legacy paths rather than preserving bugs as requirements. Prioritize rejected promises, double responses, wrong authorization, and unresolved game completion.

Exit: a reproducible baseline, explicit command inventory, and known failures with evidence. No production Discord writes.

### 2. Add strict TypeScript and move the application

- Add TypeScript, matching Node types, and type-aware ESLint tooling as development dependencies. Configure floating-promise and misused-promise checks.
- Add build, typecheck, lint, test, and development scripts. Production starts compiled `dist/index.js`; development watches TypeScript without relying on a Unix shell.
- Move every first-party `.js` implementation into the target structure as `.ts`; migrate tests as well. Preserve `src/profile.jpg` and its README reference.
- Replace filesystem command discovery with explicit typed registries and event registration. Remove source-directory reads and `process.cwd()` assumptions from help and loading.
- Keep type declarations and runtime validation distinct: casting an environment variable or database record does not validate it.
- Replace nodemon if the chosen development runner makes it redundant; otherwise keep it dev-only. Do not ship development runners in the production dependency set.

Exit: strict typecheck/build passes, no runtime JavaScript source copies remain, and loading modules does not log in, register commands, or open a database connection.

### 3. Refactor configuration and lifecycle

- Parse configuration once, before constructing the application. Preserve `TOKEN` and optional `MONGODB`; move application ID, owner ID, prefix, and server-specific mappings into documented configuration with validated types.
- Preserve the trailing space in the default `sm ` prefix. Reject invalid required configuration without logging token values or credential-bearing MongoDB URIs.
- Keep MongoDB optional. If configured, await connection and ownership indexes before accepting commands; keep fast failure when the registry is disconnected.
- Use only necessary gateway intents. Retain `Guilds`, `GuildMessages`, and `MessageContent` for prefix commands. Retain `GuildMembers` while username member queries and the existing join event need it. Remove unused presence/typing/integration/webhook/ban/emoji intents only after checking retained integrations. Setting bot activity does not itself require `GuildPresences`.
- Put activity scheduling under lifecycle ownership. The current five-minute task needs only an interval, not a cron dependency; clear the timer at shutdown and prevent duplicate scheduling.
- Handle SIGINT/SIGTERM with bounded cleanup: stop accepting work, drain in-flight permission updates, stop collectors/timers, destroy the client, disconnect MongoDB. Treat fatal process errors as termination paths, not recoverable command failures.
- Log actionable errors with command/event and guild/channel identifiers. Keep internal stacks out of Discord replies and secrets out of logs.

Exit: startup works with and without MongoDB; bad configuration fails before login; shutdown releases resources without interrupting a normal in-flight permission update.

### 4. Correct Discord command and interaction handling

- Await every command and externally visible async operation. Add error boundaries for prefix commands, slash commands, component routes, and collector callbacks.
- Use `SlashCommandBuilder` for `/help`, `/ping`, and `/calc`. Remove generic option flattening and hard-coded registered command IDs from help.
- Acknowledge interactions within Discord's three-second deadline. Defer before slow I/O; use `editReply` for deferred responses and `followUp` only after an initial response. Use `MessageFlags.Ephemeral` where appropriate.
- Make error reporting aware of `deferred` and `replied`. Failure to deliver an error reply must not become another unhandled rejection.
- Fix `/ping` to use its interaction response instead of creating and deleting an unrelated channel message before acknowledging.
- Reject bots and unsupported contexts before prefix parsing. Use the configured prefix in mention responses and deterministic argument parsing without empty whitespace tokens.
- Apply runtime authorization and bot-permission checks at the action boundary. Registration visibility/default permissions are not authorization, and a component custom ID is not proof of permission.
- Default to restricted allowed mentions; explicitly allow only mentions required by a command. Check output length limits and nullable guild/member/channel objects before building responses.
- Route persistent role/giveaway buttons separately from message-scoped game collectors. Ensure exactly one handler owns each interaction.
- Create a REST-only deploy command with explicit guild/global scope, application ID validation, payload preview, and duplicate-definition checks. Require explicit global selection; never silently fall back from a missing guild ID to global overwrite.
- Remove registration from startup. A bulk overwrite can delete commands absent from its payload, so preview and verify the target application before executing it.

Exit: rejected command promises are contained, every interaction has one valid response lifecycle, help uses the registry, and starting/reconnecting the bot makes no command-registration writes.

### 5. Migrate Channel Manager without weakening its guarantees

- Preserve model/collection identity, field names, defaults, and global unique indexes on `userId` and `channelId`. Do not change ownership to one channel per guild.
- Keep the existing permission planner and compensating rollback algorithm; type it before attempting structural simplification.
- Preserve channel-level `ManageChannels` for claims, owner/admin/bot-owner rules for management, protected blacklist targets, blacklist precedence, and departed-user removal by ID/mention.
- Preserve fresh-channel fetches, exact case-insensitive username matching, duplicate-key race handling, and deletion of stale ownership only after a definitive missing-channel result.
- Keep the re-entrant per-channel queue around fetch/read/modify/apply/save operations. A queue around only the final write would still permit lost updates.
- Preserve unrelated live permission bits and first-seen view baselines. Unlock must restore a previously private channel as private.
- Preserve distinct Discord-write failure, database-save failure, and rollback-failure outcomes. Retain an explicit operator-reconciliation response when both save and rollback fail.
- Replace global `require.cache` test mutation with a narrow injected ownership-store boundary and isolated fixtures. Do not introduce a generic repository framework or cast incomplete fakes into full Discord objects.
- Port all existing behavior tests. Add coverage only for missing consumer-visible edges discovered during the migration; do not replace assertions with weaker not-throw checks.
- Run a separate disposable-MongoDB check for actual defaults, index creation, duplicate-key errors, and old-document compatibility. The in-memory model double cannot prove those properties.

Exit: the existing regression behaviors pass unchanged, real database compatibility is demonstrated, and non-admin development-guild accounts confirm visibility changes.

### 6. Complete utilities, games, and legacy integrations

| Existing command group | Required treatment |
| --- | --- |
| `help`, `info`, `list`, `ping`; `/help`, `/ping` | Registry-based help, canonical counts, nullable user/member handling, correct response timing. |
| `avatar`, `calc`, `time`; `/calc` | Typed inputs/results and message lookup failures; share calculator logic without merging prefix/slash transport types. |
| `claim`, `lock`, `unlock`, `whitelist`, `blacklist` | Preserve the contracts in phase 5, including aliases and list/add/remove behavior. |
| `pin`, `unpin`, `pinscount` | Verify current Discord.js pin APIs and actor/bot permissions. Preserve and document the existing first-page-only count unless full pagination is explicitly added. |
| `create-channel`, `upgrade`, `resetpos` | Replace embedded server IDs with validated mappings; verify target guild, channel/category types, actor permission, and bot permissions before mutation. Fix contradictory success/failure branches in `upgrade`. |
| `turu` | Replace generated RPS scaffolding with readable TypeScript and explicit invitation/play/completion state. Preserve win/draw/decline/timeout behavior. |
| `patthearifin` | Configure the target user, preserve the GIF attachment, and verify Canvas under the final image. Keep the Canvas override required by `pet-pet-gif`. |
| `gstart`, `2iFTIvcy6`, `6nhEqa0jM3` | Preserve giveaway, role-menu, and rules-message functionality; use descriptive filenames without silently renaming public commands. |
| `echo`, `run`, `restart`, `shutdown`, `test` | Preserve documented access rules. Handle subprocess errors and deployment-specific operator actions explicitly. The public `test` command is not silently deleted. |

Additional requirements:

- RPS must settle its result on decline, timeout, completion, and failure. Validate participants and choices, prevent repeated moves, disable/remove controls when finished, and release collectors/timers.
- Audit vendored RPS provenance before editing or redistributing it. The lockfile labels `simply-djs` CC-BY-NC-ND-4.0; preserve applicable attribution and establish rights rather than assuming the repository's ISC license covers third-party code.
- Keep `simply-djs` isolated behind precise typed integration functions for the initial migration. Its unsupported status remains an explicit risk, not something TypeScript fixes. Verify all retained giveaway and role operations against the selected Discord.js version; do not stub a failing flow. If incompatible, replacement with feature/data parity becomes required work before cutover.
- Check the helper's actual giveaway persistence and startup requirements before claiming MongoDB-optional behavior covers giveaways. Preserve active giveaway data and existing role/giveaway message IDs, or perform an explicit migration/republication before removing their old routes.
- Do not mutate `message.content` to adapt giveaway parsing. Pass explicit values or use a narrow typed input boundary supported by the dependency.
- Remove direct `mongodb` and `quickmongo` dependencies only after confirming they remain unused. Replace `wait` with Node's promise-based timers; remove `node-cron` after moving its sole activity task. Update the lockfile deliberately rather than applying broad forced audit fixes.
- `run` is arbitrary program execution available to the configured owner. TypeScript and containers do not make it a sandbox. Do not broaden access, log secrets through user-facing errors, or remove the capability without an explicit decision.
- Preserve PM2 restart/stop support only as an explicitly configured deployment capability, using the compiled entry point and a configured process name. For Docker, provide accurate operator guidance instead of falsely claiming a PM2 action succeeded. A clean process exit under Compose's current `unless-stopped` policy is not a persistent shutdown; do not mount the Docker socket to implement one.

Exit: every inventoried command has a migrated implementation and a recorded outcome in its supported environment. Any intended removal, access-policy change, or unsupported integration replacement is explicit, not hidden in compilation fixes.

### 7. Package, verify, and cut over

- Rework Docker into dependency/build/runtime stages: install development dependencies to compile, then ship compiled output plus production dependencies only. Keep build/runtime OS and Node ABI compatible for Canvas.
- Preserve non-root execution, read-only root filesystem, runtime-only secrets, and `/tmp` behavior. Do not copy local build output or credentials into the build stage accidentally.
- Remove the misleading import-only healthcheck unless replacing it with an actual, documented readiness signal. Do not introduce an HTTP service solely for health reporting.
- Add CI for clean install, typecheck, lint, tests, and build. Exercise the built image separately for native dependency and runtime-path issues.
- Update README and `.env.example` with configuration, intents, build/dev commands, explicit command deployment, operator-command limitations, and retained dependency risks. Update ignore files for test build output and revised Docker inputs.
- Remove obsolete source directories, old loader code, unused dependencies/imports, and dead command metadata after all callers migrate. Keep user-facing aliases that are part of the compatibility contract.
- Stage with a separate Discord application, disposable guild, and separate MongoDB database. Never run the migration smoke checks against production by default.

Exit: the acceptance checklist below is complete and an operator can deploy or roll back using documented commands.

## Acceptance checklist

These are future implementation checks, not results of this planning pass.

- [ ] Clean `npm ci`, typecheck, lint, tests, and production build succeed on the selected runtime.
- [ ] All first-party runtime modules and tests are TypeScript; production runs compiled JavaScript without a development transpiler.
- [ ] Built registry, help, and startup work outside the repository working directory; imports have no login/registration side effects.
- [ ] Existing Channel Manager cases pass, including permission restoration, protected users, global ownership uniqueness, concurrent operations, save failure, and failed rollback.
- [ ] Real MongoDB confirms unchanged collection/index/document compatibility.
- [ ] Dispatcher tests cover asynchronous rejection before reply, after defer, and after reply; permission denial; duplicate aliases; and unsupported contexts.
- [ ] RPS checks cover all outcomes, outsider clicks, duplicate moves, expired controls, and cleanup. Giveaway and role flows work with their actual persistence/configuration requirements.
- [ ] A development guild confirms prefix commands and all three existing slash commands. Use a non-admin account for access-control checks.
- [ ] Registration preview targets the intended application/guild, and restarting the bot does not register commands.
- [ ] The built container starts without MongoDB, starts with MongoDB, rejects invalid required configuration, generates a GIF, and handles termination under read-only/non-root constraints.
- [ ] Owner-only subprocess commands remain inaccessible to ordinary users, and restart/shutdown accurately describe the selected supervisor's behavior.
- [ ] No command, alias, active persistent component, or ownership record disappears without an explicit migration decision.

## Rollout and rollback

1. Save the previous deployable image/artifact, configuration, registration payload, and a protected database backup. Validate restore access before cutover.
2. Complete development-guild checks, including old ownership documents and persistent role/giveaway messages.
3. Stop the old instance and drain permission operations before starting the new one. Do not run old and new instances concurrently against the same ownership registry.
4. Deploy slash definitions only if they changed, with explicit scope and the complete intended payload. Keep the previous payload available for restoration.
5. Start the new image and inspect login, database readiness, command errors, and representative command behavior.
6. If rollback is needed, stop the new instance first, restore the previous artifact/configuration, and restore changed command definitions explicitly. Preserve legitimate database writes; do not blindly restore an old dump over newer ownership state.
7. Reconcile Discord overwrites manually if an operation reported rollback failure. Reverting code or MongoDB alone cannot undo Discord-side changes.

## Evidence and limits of this plan

This plan is based on repository source inspection and official documentation. No dependency installation, tests, bot login, database connection, command deployment, or container execution was performed during planning. Existing test names and implementation paths provide migration requirements, not proof that the current suite passes.

References:

- [Discord.js command deployment guide](https://github.com/discordjs/guide/blob/main/guide/creating-your-bot/command-deployment.md): standalone REST deployment and guild-first testing.
- [Discord.js interaction responses](https://github.com/discordjs/guide/blob/main/guide/slash-commands/response-methods.md): acknowledgement, deferred replies, and ephemeral responses.
- [Discord.js component interactions](https://github.com/discordjs/guide/blob/main/guide/interactive-components/interactions.md): participant checks and collector timeouts.
- [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html): NodeNext and CommonJS/ESM interoperability.
- [Published Discord.js 14.27.0 metadata](https://registry.npmjs.org/discord.js/14.27.0) and [versioned documentation landing page](https://discord.js.org/docs/packages/discord.js/14.27.0): differing runtime requirements noted above.
