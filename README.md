# stack

A shared task stack for a Discord group DM, with an HTTP API and a
status page. One Node process, one SQLite file.

## How it works

A user-installed Discord app receives `/stack` commands over the gateway
(outbound WebSocket — no inbound ports, no public endpoint). All state
lives in SQLite behind a small HTTP API; the Discord handlers, the API,
and the status page are equal clients of the same operations.

## Commands

| Command                      | Behavior |
|------------------------------|----------|
| `/stack push <text> [stack]` | Push to top |
| `/stack ls [stack]`          | Top 5, `+N more` if longer; `ls *` lists every stack |
| `/stack pop [n] [stack]`     | Remove by position: `2`, `1,3`, `2-4` (default 1, the top) |
| `/stack cd <stack>`          | Set the channel's default stack |
| `/stack history [stack]`     | Recent events, newest first |

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
token as password).

## Run

```
npm install
npm run register   # once: registers /stack with Discord
npm start
npm test
```

Env (via `.env`): `DISCORD_TOKEN`, `DISCORD_APP_ID`,
`DISCORD_ALLOWED_USERS` (comma-separated user IDs), `STACK_API_TOKEN`,
`PORT` (default 8080), `DB_PATH` (default `./stack.db`).

The API binds to localhost only; reach it remotely through an SSH
tunnel. `deploy/stack.service` is an optional hardened systemd unit.
