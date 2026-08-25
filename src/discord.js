import { Client } from 'discord.js';
import * as ops from './ops.js';

export function allowedUsers(env = process.env.DISCORD_ALLOWED_USERS) {
  return (env ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const DEFAULT_LIMIT = 5;

function fmtList(stack, tasks, limit) {
  const lines = tasks.slice(0, limit).map((t, i) => `${i + 1}. ${t.title}`);
  const more = tasks.length - limit;
  return `**${stack}**\n${lines.join('\n')}${more > 0 ? `\n+${more} more` : ''}`;
}

// Takes any object shaped like a discord.js ChatInputCommandInteraction,
// so tests can drive it with plain mocks.
// "2" | "1,3" | "2-4" (mixable: "1,3-5") → sorted unique positions, or
// {error} on bad tokens / positions past `max`.
export function resolvePositions(spec, max) {
  const positions = new Set();
  for (const tok of spec.split(',').map((t) => t.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(tok);
    if (!m) return { error: `bad position: ${tok}` };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a) return { error: `bad position: ${tok}` };
    if (b > max) return { error: `no task at ${b}` };
    for (let i = a; i <= b; i++) positions.add(i);
  }
  if (positions.size === 0) return { error: `bad position: ${spec}` };
  return { positions: [...positions].sort((x, y) => x - y) };
}

export function makeHandler(db, allowed) {
  return async (interaction) => {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'stack') return;
    if (!allowed.includes(interaction.user.id)) {
      return interaction.reply(
        `you're not on the allowlist. (your Discord user ID is ${interaction.user.id} — ` +
          'add it to DISCORD_ALLOWED_USERS to enable access)',
      );
    }
    const sub = interaction.options.getSubcommand();
    const actor = interaction.user.id;
    const stackOf = () =>
      interaction.options.getString('stack') ?? ops.getDefault(db, interaction.channelId);

    try {
      // Replies stay terse: Discord shows the invoked command above each
      // reply, so the verb and stack are already on screen. Tasks are
      // addressed by position from the top (1 = top), shown only by ls;
      // global task ids exist only on the HTTP API side.
      switch (sub) {
        case 'push': {
          const task = ops.push(db, stackOf(), interaction.options.getString('text'), actor);
          return interaction.reply(task.title);
        }
        case 'pop': {
          const stack = stackOf();
          const tasks = ops.list(db, stack);
          if (tasks.length === 0) return interaction.reply(`${stack} is empty`);
          const res = resolvePositions(interaction.options.getString('n') ?? '1', tasks.length);
          if (res.error) return interaction.reply(res.error);
          const lines = res.positions.map((n) => {
            const task = ops.rm(db, tasks[n - 1].id, actor, n === 1 ? 'pop' : 'rm');
            return `~~${task.title}~~`;
          });
          return interaction.reply(lines.join('\n'));
        }
        case 'ls': {
          const stack = stackOf();
          const limit = interaction.options.getInteger('limit') ?? DEFAULT_LIMIT;
          if (stack === '*') {
            const all = ops.stacks(db);
            if (all.length === 0) return interaction.reply('no stacks');
            const blocks = all.map(({ name }) => fmtList(name, ops.list(db, name), limit));
            return interaction.reply(blocks.join('\n'));
          }
          const tasks = ops.list(db, stack);
          if (tasks.length === 0) return interaction.reply(`${stack} is empty`);
          return interaction.reply(fmtList(stack, tasks, limit));
        }
        case 'cd': {
          const stack = interaction.options.getString('stack');
          ops.cd(db, interaction.channelId, stack);
          return interaction.reply(`**${stack}**`);
        }
        case 'history': {
          const stack = stackOf();
          const limit = interaction.options.getInteger('limit') ?? DEFAULT_LIMIT;
          const events = ops.history(db, stack, limit);
          if (events.length === 0) return interaction.reply(`no history for ${stack}`);
          const lines = events.map(
            (e) => `${e.type === 'push' ? '+' : '-'} ${e.payload.title}`,
          );
          return interaction.reply(`**${stack}**\n${lines.join('\n')}`);
        }
        default:
          return interaction.reply(`\`/${sub}\`: not wired up yet.`);
      }
    } catch (err) {
      // Errors are always visible replies, never silence.
      console.error(err);
      return interaction.reply(`error running \`/${sub}\` — check the service log.`);
    }
  };
}

export function startDiscord(db, token = process.env.DISCORD_TOKEN) {
  const client = new Client({ intents: [] });
  client.on('interactionCreate', makeHandler(db, allowedUsers()));
  client.once('clientReady', (c) => console.log(`discord gateway connected as ${c.user.tag}`));
  client.login(token);
  return client;
}
