// One-shot: registers the /stack command (all subcommands, replaces the
// app's global set). Run: npm run register (needs DISCORD_TOKEN +
// DISCORD_APP_ID in .env)

const INSTALL = { integration_types: [1], contexts: [0, 1, 2] }; // user install; guild, bot DM, group DM

const stackOpt = {
  type: 3, // STRING
  name: 'stack',
  description: "Stack name (default: this channel's stack)",
  required: false,
};

const commands = [
  {
    name: 'stack',
    description: 'Shared task stack',
    ...INSTALL,
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'push',
        description: 'Add a task to the top',
        options: [
          { type: 3, name: 'text', description: 'Task text', required: true },
          stackOpt,
        ],
      },
      {
        type: 1,
        name: 'pop',
        description: 'Remove and show tasks by position (default: top)',
        options: [
          {
            type: 3,
            name: 'n',
            description: 'Position(s) from top: 2 | 1,3 | 2-4 (default 1)',
            required: false,
          },
          stackOpt,
        ],
      },
      {
        type: 1,
        name: 'ls',
        description: 'Show the stack, top first (* = all stacks)',
        options: [stackOpt],
      },
      {
        type: 1,
        name: 'cd',
        description: "Set this channel's default stack",
        options: [{ type: 3, name: 'stack', description: 'Stack name', required: true }],
      },
      {
        type: 1,
        name: 'history',
        description: 'Recent events, newest first',
        options: [stackOpt],
      },
    ],
  },
];

const { DISCORD_TOKEN, DISCORD_APP_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_APP_ID) {
  console.error('DISCORD_TOKEN and DISCORD_APP_ID must be set');
  process.exit(1);
}

const res = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`, {
  method: 'PUT',
  headers: {
    authorization: `Bot ${DISCORD_TOKEN}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`registration failed: ${res.status}`, await res.text());
  process.exit(1);
}
const body = await res.json();
console.log(`registered: ${body.map((c) => c.name).join(', ')}`);
