import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';

test('migration creates tables and is idempotent', () => {
  const db = openDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  for (const t of ['tasks', 'events', 'channel_defaults']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  db.exec('SELECT 1'); // still usable
  db.close();
});

test('data survives close and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stack-'));
  const path = join(dir, 'stack.db');
  try {
    let db = openDb(path);
    db.prepare("INSERT INTO tasks (stack, title) VALUES ('~', 'persist me')").run();
    db.close();

    db = openDb(path); // migration runs again, must not clobber
    const row = db.prepare('SELECT title FROM tasks').get();
    assert.equal(row.title, 'persist me');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
