# stack

A shared task stack for a Discord group DM, with an HTTP API and a
status page. One Node process, one SQLite file.

## How it works

A user-installed Discord app receives `/stack` commands over the gateway
(outbound WebSocket — no inbound ports, no public endpoint, no TLS). All
state lives in SQLite behind a small HTTP API; the Discord handlers, the
API, and the status page are equal clients of the same operations.

Constraints that shaped the design: bots cannot join group DMs, so a
user-installed app is the only way to get commands there — and it gets
interactions only (it cannot read messages or post unprompted). Command
responses are visible to everyone in the DM, which is the point.

## Commands

| Command                      | Behavior |
|------------------------------|----------|
| `/stack push <text> [stack]` | Push to top |
| `/stack ls [stack]`          | Top 5, `+N more` if longer; `ls *` lists every stack |
| `/stack pop [n] [stack]`     | Remove by position: `2`, `1,3`, `2-4` (default 1, the top) |
| `/stack cd <stack>`          | Set the channel's default stack |
| `/stack history [stack]`     | Recent events, newest first |

`[stack]` defaults to the channel's current stack (`~` if `cd` was never
used). Positions are resolved against the stack as `ls` showed it and
validated before anything is removed.

## HTTP API

Bearer-token JSON API (`Authorization: Bearer $STACK_API_TOKEN`):

| Method & path              | Behavior                     |
|----------------------------|------------------------------|
| GET  /stacks               | All stacks with task counts  |
| GET  /stacks/:name         | Ordered tasks, top first     |
| GET  /stacks/:name/history | Event log, newest first      |
| POST /stacks/:name/push    | Body `{title}` → created task|
| POST /stacks/:name/pop     | → removed task; 409 if empty |
| DELETE /tasks/:id          | 404 if unknown               |
| GET  /tasks/:id            | Full task                    |

`GET /` is a read-only status page (HTTP basic auth: any username, the
token as password — so a browser can prompt for it).

The API binds to localhost only. Reach it from other machines through an
SSH tunnel: `ssh -L 8080:localhost:8080 <host>`, then
`http://localhost:8080/`.

## Setup

Requires Node 22+.

**1. Create the Discord application** at
<https://discord.com/developers/applications> (this part has no API):

- **General Information**: copy the Application ID.
- **Installation**: enable the **User Install** context and keep the
  Discord-provided install link. Leave the Interactions Endpoint URL
  **unset** — setting it switches Discord to webhook delivery and the
  gateway stops receiving commands.
- **Bot**: create the bot and copy its token.

**2. Install the app** — every user who will invoke commands opens the
install link and installs it to their account. In a group DM it is
enough that the invoker has it installed; installing it for all members
means anyone can run commands.

**3. Collect Discord user IDs** for the allowlist: Discord settings →
Advanced → Developer Mode, then right-click a user → Copy User ID.
Anyone with the install link can add the app, so the service refuses
every user not on this list (the refusal message shows the caller's ID,
which makes bootstrapping easy).

**4. Configure** — create `.env` in the repo root, `chmod 600`:

```
DISCORD_TOKEN=<bot token>
DISCORD_APP_ID=<application id>
DISCORD_ALLOWED_USERS=<id1>,<id2>
STACK_API_TOKEN=<32+ random chars, e.g. openssl rand -hex 32>
# optional: PORT=8080  DB_PATH=./stack.db
```

**5. Register and run:**

```
npm install
npm run register   # once, and again whenever command definitions change
npm start
npm test
```

Verify: `/stack push` something in the DM, then
`curl -H "Authorization: Bearer $STACK_API_TOKEN" localhost:8080/stacks/~`
shows it.

## Deploying

The process is a single long-running Node program; anything that keeps
it alive works. Three options, smallest first:

### Foreground (development)

`npm start`. Ctrl-C to stop. The SQLite file survives restarts.

### User cron, no root

Runs as your own account; nothing outside your home directory. On a
shared machine, keep the directory private (the DB and `.env` live in
it):

```
chmod 700 ~/stack
crontab -e   # add, adjusting the node path:
@reboot cd $HOME/stack && $(command -v node) --env-file=.env src/index.js >> stack.log 2>&1
```

Start it for the current boot with the same command under `nohup`.
Trade-offs: no supervision (a crash stays down until you restart it) and
the service runs with your account's privileges.

### systemd (supervised, hardened)

`deploy/stack.service` runs the service as a dedicated no-login user
with state in `/var/lib/stack`, secrets in root-owned `/etc/stack.env`,
and restart-on-failure. Install steps are in the unit file's header
comments. Use this when the machine is shared or the service should
outlive its author's account.
