import { openDb } from './db.js';
import { createApi } from './api.js';
import { startDiscord } from './discord.js';

const db = openDb();
const port = Number(process.env.PORT ?? 8080);

// localhost only — the host may be shared, so the bearer token is the
// auth, not the bind address; there is no reason to listen wider.
createApi(db, process.env.STACK_API_TOKEN).listen(port, '127.0.0.1', () => {
  console.log(`stack api on http://127.0.0.1:${port}`);
});

if (process.env.DISCORD_TOKEN) {
  startDiscord(db);
} else {
  console.log('DISCORD_TOKEN not set — running API only');
}
