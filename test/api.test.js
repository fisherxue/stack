import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApi } from '../src/api.js';

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef';

async function withApi(fn) {
  const db = openDb(':memory:');
  const server = createApi(db, TOKEN);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, token = TOKEN) =>
    fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  call.base = base;
  try {
    await fn(call);
  } finally {
    server.close();
    db.close();
  }
}

test('rejects missing and wrong tokens with 401', () =>
  withApi(async (call) => {
    let res = await call('GET', '/stacks', null, 'wrong-token');
    assert.equal(res.status, 401);
    res = await call('GET', '/stacks', null, '');
    assert.equal(res.status, 401);
  }));

test('push / ls / pop round trip', () =>
  withApi(async (call) => {
    let res = await call('POST', '/stacks/~/push', { title: 'buy milk' });
    assert.equal(res.status, 201);
    const task = await res.json();
    assert.equal(task.title, 'buy milk');

    res = await call('GET', '/stacks/~');
    const tasks = await res.json();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, task.id);

    res = await call('POST', '/stacks/~/pop');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, task.id);

    res = await call('POST', '/stacks/~/pop');
    assert.equal(res.status, 409);
  }));

test('task get/delete, 404 on unknown', () =>
  withApi(async (call) => {
    const task = await (await call('POST', '/stacks/work/push', { title: 'x' })).json();

    assert.equal((await call('GET', `/tasks/${task.id}`)).status, 200);
    assert.equal((await call('DELETE', `/tasks/${task.id}`)).status, 200);
    assert.equal((await call('GET', `/tasks/${task.id}`)).status, 404);
    assert.equal((await call('DELETE', '/tasks/9999')).status, 404);
  }));

test('stacks listing, history, and bad bodies', () =>
  withApi(async (call) => {
    await call('POST', '/stacks/work/push', { title: 'a' });
    await call('POST', '/stacks/work/push', { title: 'b' });
    await call('POST', '/stacks/work/pop');

    const stacks = await (await call('GET', '/stacks')).json();
    assert.deepEqual(stacks, [{ name: 'work', count: 1 }]);

    const history = await (await call('GET', '/stacks/work/history')).json();
    assert.deepEqual(history.map((e) => e.type), ['pop', 'push', 'push']);
    assert.equal(history[0].actor, 'api');

    assert.equal((await call('POST', '/stacks/work/push', {})).status, 400);
    assert.equal((await call('GET', '/nope')).status, 404);
  }));

test('unknown stack reads return empty lists, not 404', () =>
  withApi(async (call) => {
    assert.deepEqual(await (await call('GET', '/stacks/ghost')).json(), []);
    assert.deepEqual(await (await call('GET', '/stacks/ghost/history')).json(), []);
  }));

test('status page: basic auth for browsers, bearer also accepted', () =>
  withApi(async (call) => {
    await call('POST', '/stacks/work/push', { title: 'seen <on> page' });
    const base = call.base;

    let res = await fetch(base + '/');
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Basic realm="stack"');

    res = await fetch(base + '/', {
      headers: { authorization: `Basic ${Buffer.from(`x:${TOKEN}`).toString('base64')}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /seen &lt;on&gt; page/); // escaped
    assert.match(html, /work/);

    res = await fetch(base + '/', { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
  }));
