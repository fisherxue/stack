# stack

A shared task stack for a Discord group DM, with an HTTP API and a
status page. The service is one Node.js process backed by one SQLite
file.

## Architecture

The service connects to Discord over the gateway, an outbound WebSocket.
It needs no inbound ports, no public endpoint, and no TLS. A
user-installed Discord app provides the `/stack` command in the group
DM.

All state lives in SQLite. The Discord handlers, the HTTP API, and the
status page call the same internal operations.

Discord constraints that shaped the design:

- Bots can't join group DMs. A user-installed app is the only way to
  provide commands there.
- User-installed apps receive interactions only. They can't read
  messages or send unprompted messages.
- Command responses are visible to everyone in the DM.

## Commands

| Command                      | Description |
|------------------------------|-------------|
| `/stack push <text> [stack]` | Adds a task to the top. |
| `/stack ls [stack]`          | Lists the top 5 tasks, then `+N more` if the stack is longer. `ls *` lists every stack. |
| `/stack pop [n] [stack]`     | Removes tasks by position: `2`, `1,3`, or `2-4`. Defaults to `1`, the top. |
| `/stack cd <stack>`          | Sets the channel's default stack. |
| `/stack history [stack]`     | Lists recent events, newest first. |

`[stack]` defaults to the channel's current stack, or `~` if `cd` was
never used. Positions refer to the stack as `ls` showed it, and the
service validates every position before it removes anything.

## HTTP API

All routes except `/` require `Authorization: Bearer $STACK_API_TOKEN`.

| Method and path            | Description                       |
|----------------------------|-----------------------------------|
| GET  /stacks               | All stacks with task counts.      |
| GET  /stacks/:name         | Ordered tasks, top first.         |
| GET  /stacks/:name/history | Event log, newest first.          |
| POST /stacks/:name/push    | Body `{title}`. Returns the created task. |
| POST /stacks/:name/pop     | Returns the removed task, or 409 if the stack is empty. |
| DELETE /tasks/:id          | Returns 404 if the ID is unknown. |
| GET  /tasks/:id            | Returns the full task.            |

`GET /` returns a read-only status page. It accepts HTTP basic
authentication — any username, with the token as the password — so a
browser can prompt for credentials.

The API binds to localhost only. To reach it from another machine, use
an SSH tunnel:

```
ssh -L 8080:localhost:8080 HOST
```

Then open `http://localhost:8080/`.

## Setup

Setup requires Node.js 22 or later.

### 1. Create the Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. On the **General Information** page, copy the application ID.
2. On the **Installation** page, enable the **User Install** context and
   copy the install link. Leave the Interactions Endpoint URL unset:
   setting it switches delivery to webhooks, and the gateway stops
   receiving commands.
3. On the **Bot** page, create the bot and copy its token.

### 2. Install the app

Each user who will invoke commands opens the install link and installs
the app to their account.

### 3. Collect user IDs

The service refuses any user that isn't on its allowlist, because
anyone with the install link can add the app. To copy an ID in Discord,
enable Developer Mode under **Settings > Advanced**, right-click a
user, and select **Copy User ID**. The refusal reply also shows the
caller's ID.

### 4. Configure

Create `.env` in the repository root and set its mode to 600:

```
DISCORD_TOKEN=<bot token>
DISCORD_APP_ID=<application id>
DISCORD_ALLOWED_USERS=<id1>,<id2>
STACK_API_TOKEN=<32 or more random characters>
# Optional: PORT=8080  DB_PATH=./stack.db
```

To generate the API token, run, for example, `openssl rand -hex 32`.

### 5. Register and run

```
npm install
npm run register
npm start
npm test
```

Run `npm run register` once, and again whenever the command definitions
change.

To verify the round trip, push a task in Discord, then confirm the API
returns it:

```
curl -H "Authorization: Bearer $STACK_API_TOKEN" localhost:8080/stacks/~
```

## Deployment

Any mechanism that keeps the process alive works. Three options follow,
smallest first.

### Foreground

Run `npm start`. Press Ctrl+C to stop. The SQLite file persists across
restarts.

### User cron

This option runs the service as your account and needs no root access.
On a shared machine, keep the directory private, because it contains
the database and `.env`:

```
chmod 700 ~/stack
crontab -e   # Add the following line, adjusting the node path:
@reboot cd $HOME/stack && $(command -v node) --env-file=.env src/index.js >> stack.log 2>&1
```

To start the service for the current boot, run the same command under
`nohup`.

Limitations: nothing restarts the service after a crash, and the
service runs with your account's privileges.

### systemd

`deploy/stack.service` runs the service as a dedicated no-login user,
stores state in `/var/lib/stack`, reads secrets from a root-owned
`/etc/stack.env`, and restarts on failure. The unit file's header
comments contain the install steps. Use this option when the machine is
shared or the service must outlive its author's account.

### Pull-based auto-deploy

To make a push to `main` deploy itself, run `deploy/pull.sh` from cron
on the host. The script polls the repository, and on new commits it
resets the working tree, runs `npm ci` if the lockfile changed, and
restarts the service. It needs a read-only deploy key and one crontab
entry; see the script's header comments. This keeps all credentials on
the host and needs no inbound ports or CI runners.
