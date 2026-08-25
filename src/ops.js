export const DEFAULT_STACK = '~';

function logEvent(db, stack, type, actor, payload) {
  db.prepare('INSERT INTO events (stack, type, actor, payload) VALUES (?, ?, ?, ?)').run(
    stack,
    type,
    actor,
    JSON.stringify(payload),
  );
}

export function push(db, stack, title, actor) {
  return db.transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare('INSERT INTO tasks (stack, title) VALUES (?, ?)')
      .run(stack, title);
    logEvent(db, stack, 'push', actor, { id: Number(id), title });
    return getTask(db, Number(id));
  })();
}

// Top of a stack = highest id (push is LIFO). Returns null if empty.
export function pop(db, stack, actor) {
  return db.transaction(() => {
    const task = db
      .prepare('SELECT * FROM tasks WHERE stack = ? ORDER BY id DESC LIMIT 1')
      .get(stack);
    if (!task) return null;
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    logEvent(db, stack, 'pop', actor, { id: task.id, title: task.title });
    return task;
  })();
}

// eventType lets a positional pop of the top log as 'pop' instead.
export function rm(db, id, actor, eventType = 'rm') {
  return db.transaction(() => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) return null;
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    logEvent(db, task.stack, eventType, actor, { id: task.id, title: task.title });
    return task;
  })();
}

export function getTask(db, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) ?? null;
}

export function list(db, stack) {
  return db.prepare('SELECT * FROM tasks WHERE stack = ? ORDER BY id DESC').all(stack);
}

export function stacks(db) {
  return db
    .prepare('SELECT stack AS name, COUNT(*) AS count FROM tasks GROUP BY stack ORDER BY stack')
    .all();
}

export function allHistory(db, limit = 20) {
  return db
    .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
}

export function history(db, stack, limit = 10) {
  return db
    .prepare('SELECT * FROM events WHERE stack = ? ORDER BY id DESC LIMIT ?')
    .all(stack, limit)
    .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
}

export function cd(db, channelId, stack) {
  db.prepare(
    'INSERT INTO channel_defaults (channel_id, stack) VALUES (?, ?) ' +
      'ON CONFLICT (channel_id) DO UPDATE SET stack = excluded.stack',
  ).run(channelId, stack);
}

export function getDefault(db, channelId) {
  const row = db.prepare('SELECT stack FROM channel_defaults WHERE channel_id = ?').get(channelId);
  return row?.stack ?? DEFAULT_STACK;
}
