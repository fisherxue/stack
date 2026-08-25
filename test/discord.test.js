import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { makeHandler, allowedUsers } from '../src/discord.js';
import * as ops from '../src/ops.js';

const ALLOWED = ['111', '222'];

function mockInteraction({ userId, sub = 'ls', options = {}, channel = 'chan1' }) {
  const replies = [];
  const m = {
    replies,
    deleteCalls: 0,
    isChatInputCommand: () => true,
    commandName: 'stack',
    user: { id: userId },
    channelId: channel,
    options: {
      getSubcommand: () => sub,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
    },
    reply: (msg) => {
      replies.push(msg);
      return Promise.resolve();
    },
    deleteReply: () => {
      m.deleteCalls += 1;
      return Promise.resolve();
    },
  };
  return m;
}

test('allowlist: unknown user is refused with a visible reply showing their id', async () => {
  const handler = makeHandler(openDb(':memory:'), ALLOWED);
  const i = mockInteraction({ userId: '999' });
  await handler(i);
  assert.equal(i.replies.length, 1);
  assert.match(i.replies[0], /not on the allowlist/);
  assert.match(i.replies[0], /999/);
});

test('push then ls: task visible with id, LIFO numbering', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);

  const p1 = mockInteraction({ userId: '111', sub: 'push', options: { text: 'first' } });
  await handler(p1);
  assert.equal(p1.replies[0], 'first');

  await handler(mockInteraction({ userId: '222', sub: 'push', options: { text: 'second' } }));

  const ls = mockInteraction({ userId: '111', sub: 'ls' });
  await handler(ls);
  assert.equal(ls.replies[0], '**~**\n1. second\n2. first');
});

test('ls shows only the top 5 and counts the rest', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);
  for (let i = 1; i <= 7; i++) {
    await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: `t${i}` } }));
  }
  const ls = mockInteraction({ userId: '111', sub: 'ls' });
  await handler(ls);
  assert.equal(ls.replies[0], '**~**\n1. t7\n2. t6\n3. t5\n4. t4\n5. t3\n+2 more');
});

test('pop returns top task; empty stack says so', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);
  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'only' } }));

  const pop = mockInteraction({ userId: '111', sub: 'pop' });
  await handler(pop);
  assert.equal(pop.replies[0], '~~only~~');

  const again = mockInteraction({ userId: '111', sub: 'pop' });
  await handler(again);
  assert.match(again.replies[0], /is empty/);

  const ls = mockInteraction({ userId: '111', sub: 'ls' });
  await handler(ls);
  assert.match(ls.replies[0], /is empty/);
});

test('pop n removes by position from top; out of range gets visible error', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);
  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'bottom' } }));
  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'top' } }));

  const pop2 = mockInteraction({ userId: '111', sub: 'pop', options: { n: '2' } });
  await handler(pop2);
  assert.equal(pop2.replies[0], '~~bottom~~');
  assert.deepEqual(ops.list(db, '~').map((t) => t.title), ['top']);

  const bad = mockInteraction({ userId: '111', sub: 'pop', options: { n: '5' } });
  await handler(bad);
  assert.equal(bad.replies[0], 'no task at 5');

  const events = ops.history(db, '~', 10);
  assert.deepEqual(events.map((e) => e.type), ['rm', 'push', 'push']); // pop n>1 logs as rm
});

test('pop accepts lists and ranges, atomically validated', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);
  for (const t of ['e', 'd', 'c', 'b', 'a']) {
    await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: t } }));
  }
  // stack top-first: a b c d e

  const list = mockInteraction({ userId: '111', sub: 'pop', options: { n: '1,3' } });
  await handler(list);
  assert.equal(list.replies[0], '~~a~~\n~~c~~');
  assert.deepEqual(ops.list(db, '~').map((t) => t.title), ['b', 'd', 'e']);

  const range = mockInteraction({ userId: '111', sub: 'pop', options: { n: '2-3' } });
  await handler(range);
  assert.equal(range.replies[0], '~~d~~\n~~e~~');
  assert.deepEqual(ops.list(db, '~').map((t) => t.title), ['b']);

  // any bad position → nothing removed
  const bad = mockInteraction({ userId: '111', sub: 'pop', options: { n: '1,9' } });
  await handler(bad);
  assert.equal(bad.replies[0], 'no task at 9');
  assert.equal(ops.list(db, '~').length, 1);

  const junk = mockInteraction({ userId: '111', sub: 'pop', options: { n: 'x' } });
  await handler(junk);
  assert.equal(junk.replies[0], 'bad position: x');
});

test('stack option overrides the channel default', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);
  await handler(
    mockInteraction({ userId: '111', sub: 'push', options: { text: 'elsewhere', stack: 'work' } }),
  );
  assert.equal(ops.list(db, '~').length, 0);
  assert.equal(ops.list(db, 'work')[0].title, 'elsewhere');

  const ls = mockInteraction({ userId: '111', sub: 'ls', options: { stack: 'work' } });
  await handler(ls);
  assert.match(ls.replies[0], /elsewhere/);
});

test('Discord pushes and API-side ops see the same data', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);
  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'shared' } }));

  // same db, other client's view
  assert.equal(ops.list(db, '~')[0].title, 'shared');
  ops.push(db, '~', 'from api', 'api');

  const ls = mockInteraction({ userId: '222', sub: 'ls' });
  await handler(ls);
  assert.equal(ls.replies[0], '**~**\n1. from api\n2. shared');

  const events = ops.history(db, '~', 10);
  assert.deepEqual(events.map((e) => e.actor), ['api', '111']);
});

test('non-stack and non-command interactions are ignored', async () => {
  const handler = makeHandler(openDb(':memory:'), ALLOWED);

  const other = mockInteraction({ userId: '111' });
  other.commandName = 'weather';
  await handler(other);
  assert.equal(other.replies.length, 0);

  const notCommand = mockInteraction({ userId: '111' });
  notCommand.isChatInputCommand = () => false;
  await handler(notCommand);
  assert.equal(notCommand.replies.length, 0);
});

test('allowedUsers parses the env format', () => {
  assert.deepEqual(allowedUsers('111, 222 ,'), ['111', '222']);
  assert.deepEqual(allowedUsers(''), []);
  assert.deepEqual(allowedUsers(undefined), []);
});

test('ls * lists every stack', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);

  const empty = mockInteraction({ userId: '111', sub: 'ls', options: { stack: '*' } });
  await handler(empty);
  assert.equal(empty.replies[0], 'no stacks');

  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'home task' } }));
  await handler(
    mockInteraction({ userId: '111', sub: 'push', options: { text: 'job', stack: 'work' } }),
  );

  const all = mockInteraction({ userId: '111', sub: 'ls', options: { stack: '*' } });
  await handler(all);
  assert.equal(all.replies[0], '**work**\n1. job\n**~**\n1. home task');
});

test('cd sets the channel default used by later commands', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);

  const cd = mockInteraction({ userId: '111', sub: 'cd', options: { stack: 'work' } });
  await handler(cd);
  assert.equal(cd.replies[0], '**work**');
  assert.equal(ops.getDefault(db, 'chan1'), 'work');

  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'in work now' } }));
  assert.equal(ops.list(db, 'work')[0].title, 'in work now');
  assert.equal(ops.list(db, '~').length, 0);
});

test('history shows +/- lines newest first; empty says so', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);

  const none = mockInteraction({ userId: '111', sub: 'history' });
  await handler(none);
  assert.equal(none.replies[0], 'no history for ~');

  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'a' } }));
  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'b' } }));
  await handler(mockInteraction({ userId: '111', sub: 'pop' }));

  const h = mockInteraction({ userId: '111', sub: 'history' });
  await handler(h);
  assert.equal(h.replies[0], '**~**\n- b\n+ b\n+ a');
});

test('ls and history accept a limit option; history defaults to 5', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);
  for (let i = 1; i <= 7; i++) {
    await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: `t${i}` } }));
  }

  const ls7 = mockInteraction({ userId: '111', sub: 'ls', options: { limit: 7 } });
  await handler(ls7);
  assert.equal(ls7.replies[0], '**~**\n1. t7\n2. t6\n3. t5\n4. t4\n5. t3\n6. t2\n7. t1');

  const h = mockInteraction({ userId: '111', sub: 'history' });
  await handler(h);
  assert.equal(h.replies[0], '**~**\n+ t7\n+ t6\n+ t5\n+ t4\n+ t3');

  const h7 = mockInteraction({ userId: '111', sub: 'history', options: { limit: 7 } });
  await handler(h7);
  assert.equal(h7.replies[0].split('\n').length, 8); // header + 7 events
});

test('view replies delete when the next command arrives; mutations stay', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);

  const ls1 = mockInteraction({ userId: '111', sub: 'ls' });
  await handler(ls1);
  const push = mockInteraction({ userId: '111', sub: 'push', options: { text: 'a' } });
  await handler(push);
  assert.equal(ls1.deleteCalls, 1); // ls cleaned up by the push
  assert.equal(push.deleteCalls, 0);

  const pop = mockInteraction({ userId: '111', sub: 'pop' });
  await handler(pop);
  assert.equal(push.deleteCalls, 0); // push reply is permanent
  assert.equal(pop.deleteCalls, 0);

  const ls2 = mockInteraction({ userId: '111', sub: 'ls' });
  await handler(ls2);
  const ls3 = mockInteraction({ userId: '111', sub: 'ls' });
  await handler(ls3);
  assert.equal(ls2.deleteCalls, 1); // replaced by ls3
  assert.equal(ls3.deleteCalls, 0); // still tracked
});

test('refusal replies are transient too', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);

  const stranger = mockInteraction({ userId: '999' });
  await handler(stranger);
  assert.match(stranger.replies[0], /allowlist/);

  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'x' } }));
  assert.equal(stranger.deleteCalls, 1);
});

test('transient tracking is per channel', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);

  const lsA = mockInteraction({ userId: '111', sub: 'ls', channel: 'chanA' });
  await handler(lsA);
  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'x' }, channel: 'chanB' }));
  assert.equal(lsA.deleteCalls, 0); // untouched by activity in chanB

  await handler(mockInteraction({ userId: '111', sub: 'push', options: { text: 'y' }, channel: 'chanA' }));
  assert.equal(lsA.deleteCalls, 1);
});

test('a failed delete (expired token) does not break handling', async () => {
  const db = openDb(':memory:');
  const handler = makeHandler(db, ALLOWED);

  const old = mockInteraction({ userId: '111', sub: 'ls' });
  old.deleteReply = () => Promise.reject(new Error('Unknown Webhook'));
  await handler(old);

  const push = mockInteraction({ userId: '111', sub: 'push', options: { text: 'still works' } });
  await handler(push);
  assert.equal(push.replies[0], 'still works');
});
