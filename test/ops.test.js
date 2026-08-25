import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import * as ops from '../src/ops.js';

const A = 'user1';

function freshDb() {
  return openDb(':memory:');
}

test('push/push/pop leaves one task, LIFO order', () => {
  const db = freshDb();
  ops.push(db, '~', 'first', A);
  const second = ops.push(db, '~', 'second', A);

  const popped = ops.pop(db, '~', A);
  assert.equal(popped.id, second.id);
  assert.equal(popped.title, 'second');

  const left = ops.list(db, '~');
  assert.equal(left.length, 1);
  assert.equal(left[0].title, 'first');
});

test('pop on empty stack returns null', () => {
  const db = freshDb();
  assert.equal(ops.pop(db, '~', A), null);
});

test('rm removes exactly the given id, unknown id returns null', () => {
  const db = freshDb();
  const t1 = ops.push(db, '~', 'keep', A);
  const t2 = ops.push(db, '~', 'remove', A);

  const removed = ops.rm(db, t2.id, A);
  assert.equal(removed.title, 'remove');
  assert.equal(ops.rm(db, 9999, A), null);

  const left = ops.list(db, '~');
  assert.deepEqual(left.map((t) => t.id), [t1.id]);
});

test('every op writes a matching event', () => {
  const db = freshDb();
  const t = ops.push(db, '~', 'a task', A);
  ops.pop(db, '~', A);
  const t2 = ops.push(db, '~', 'other', A);
  ops.rm(db, t2.id, A);

  const events = ops.history(db, '~', 10);
  assert.deepEqual(events.map((e) => e.type), ['rm', 'push', 'pop', 'push']); // newest first
  assert.equal(events[1].payload.title, 'other');
  assert.equal(events[3].payload.id, t.id);
  for (const e of events) assert.equal(e.actor, A);
});

test('history is capped and per-stack', () => {
  const db = freshDb();
  for (let i = 0; i < 15; i++) ops.push(db, '~', `t${i}`, A);
  ops.push(db, 'work', 'elsewhere', A);

  assert.equal(ops.history(db, '~', 10).length, 10);
  const work = ops.history(db, 'work', 10);
  assert.equal(work.length, 1);
  assert.equal(work[0].payload.title, 'elsewhere');
});

test('stacks are isolated; ids are global and never reused', () => {
  const db = freshDb();
  const a = ops.push(db, 'alpha', 'in alpha', A);
  const b = ops.push(db, 'beta', 'in beta', A);
  assert.notEqual(a.id, b.id);

  ops.pop(db, 'beta', A);
  const c = ops.push(db, 'beta', 'again', A);
  assert.ok(c.id > b.id, 'AUTOINCREMENT must not reuse ids');
  assert.equal(ops.list(db, 'alpha').length, 1);
});

test('cd sets per-channel default, ~ when unset', () => {
  const db = freshDb();
  assert.equal(ops.getDefault(db, 'chan1'), '~');
  ops.cd(db, 'chan1', 'work');
  assert.equal(ops.getDefault(db, 'chan1'), 'work');
  ops.cd(db, 'chan1', 'play');
  assert.equal(ops.getDefault(db, 'chan1'), 'play');
  assert.equal(ops.getDefault(db, 'chan2'), '~');
});

test('stacks lists names with counts', () => {
  const db = freshDb();
  ops.push(db, '~', 'one', A);
  ops.push(db, 'work', 'two', A);
  ops.push(db, 'work', 'three', A);
  assert.deepEqual(ops.stacks(db), [
    { name: 'work', count: 2 },
    { name: '~', count: 1 },
  ]);
});
