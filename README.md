# Smol Maiden Discord Bot

<p align="center">
  <img src="./src/profile.jpg" alt="Smol Maiden Profile Picture" title="Smol Maiden profile picture" width="200"/>
</p>

Smol Maiden#1515 is a cute, smol Discord bot made using [Discord.js](https://discord.js.org/) v14 — and she is **free and open source**! Use her, modify her, self-host her~ 🩷

The only support and testing server is [here](https://discord.gg/2SatpX28ZX).

## ✨ Features

- Prefix commands (`sm <command>`) and slash commands (`/help`, `/ping`, `/calc`)
- Fun & utility: calculator (via [mathjs](https://mathjs.org/)), avatars, giveaways & rock-paper-scissors (via [simply-djs](https://simplyd.js.org)), headpats (via [pet-pet-gif](https://github.com/aiko-chan-asa/pet-pet-gif))
- Channel helpers: create, pin, unpin, pins count, upgrade
- MongoDB support (optional) via [mongoose](https://mongoosejs.com/)
- Docker support for easy deployment

## 📋 Requirements

- [Node.js](https://nodejs.org/) 18+ and [npm](https://www.npmjs.com/)
- A [Discord application](https://discord.com/developers/applications) with a bot account
- (Optional) a MongoDB database — [MongoDB Atlas](https://www.mongodb.com/atlas) has a free tier

## 🚀 Setup

1. **Clone and install**
   ```sh
   git clone https://github.com/Frsxk/smol-maiden-bot.git
   cd smol-maiden-bot
   npm install
   ```
2. **Create your bot** on the [Discord Developer Portal](https://discord.com/developers/applications), then under **Bot**:
   - copy your **token**
   - enable the **privileged intents** the bot uses: *Server Members*, *Message Content*, and *Presence* — Smol Maiden will refuse to start without them
3. **Invite the bot** to your server using the OAuth2 URL Generator with the `bot` scope (and `applications.commands` for slash commands)
4. **Configure** — copy `.env.example` to `.env` and fill in:
   ```
   TOKEN=your-bot-token
   MONGODB=your-mongodb-uri   # optional, for mongo-backed features
   ```
   Then edit `config.js` for your own instance:
   - `botClientID` and `ownerID` → **your** application/user IDs
   - `botPrefix`, `embedColor`, footer texts → taste~
   > ⚠️ `ownerID` matters! Several commands (`run`, `echo`, `restart`, `shutdown`, …) are owner-only and `run` executes commands on the host machine — only point it at yourself.
5. **Start**
   ```sh
   npm start
   ```

## 🐳 Docker

```sh
docker compose up -d        # build & run in background
docker compose logs -f      # follow logs
docker compose down         # stop
```
Secrets are injected at runtime from your local `.env` (never baked into the image).

## 📜 Commands

Prefix is `sm ` (with a space). Run `sm help` in Discord for the live list.

**Everyone:**

| Command | Aliases | What it does |
|---|---|---|
| `sm help [command]` | `h`, `commands` | List commands or details for one |
| `sm info` | `i`, `information` | Bot info |
| `sm list` | `cmd`, `ls` | List commands by category |
| `sm ping` | `pong`, `latency` | Bot latency |
| `sm avatar [user]` | `av`, `profile`, `pfp` | Show someone's avatar (user & server versions) |
| `sm calc <expression>` | `calculate`, `c` | Calculator powered by mathjs |
| `sm time` | — | Current time |
| `sm create-ch` | — | Create a channel |
| `sm pin` / `sm unpin` | — | Pin/unpin in your channel |
| `sm pinscount` | `pc` | Count pinned messages |
| `sm upgrade` | — | Channel upgrade helper |
| `sm patthearifin` | `petthearifin`, `arifin`, `afn` | Headpats 🐾 |
| `sm turu` | — | Rock-paper-scissors |

**Slash commands:** `/help`, `/ping`, `/calc`

**Owner-only:** `sm run`, `sm echo`, `sm gstart`, `sm restart`, `sm shutdown`, `sm resetpos` (plus a couple of secret ones — how did you even find this README? 👀)

> Some legacy Channel Manager commands (`lock`, `unlock`, `blacklist`, `whitelist`) are discontinued stubs kept for history.

## 🛠️ Tech

- [Discord.js](https://discord.js.org/) v14
- [simply-djs](https://simplyd.js.org) — giveaways, button roles, RPS
- [mathjs](https://mathjs.org) — calculator
- [pet-pet-gif](https://github.com/aiko-chan-asa/pet-pet-gif) — headpats
- [mongoose](https://mongoosejs.com/) — MongoDB ODM (optional)
- Started from [Expectative's Discord.js bot example](https://github.com/Expectatives/Discord.js-v13-Example/) — big thanks to them!

## 📮 Contact

To report bugs or abuse, please join [the support server](https://discord.gg/2SatpX28ZX).
If you want to chat, add me as a friend on Discord: `@frxskie`

## 🎨 Credits

- Smol Maiden's adorable profile picture: [@kudukimii](https://twitter.com/kudukimii) on twt/X

## 📄 License

This project is licensed under the [ISC License](./LICENSE) — do whatever you like, just keep the notice~

*Smol Maiden is such a cutie.* 🩷
