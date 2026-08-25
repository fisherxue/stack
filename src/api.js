import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import * as ops from './ops.js';
import { renderStatusPage } from './page.js';

const API_ACTOR = 'api';

// Hash both sides so lengths always match; localhost callers on a shared
// box get unlimited fast guesses, so the comparison must be constant-time.
function equalTokens(given, want) {
  return timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(want).digest(),
  );
}

function tokenOk(header, token) {
  if (!header?.startsWith('Bearer ')) return false;
  return equalTokens(header.slice(7), token);
}

// The status page is opened in a browser, which cannot set a Bearer
// header — accept basic auth with the token as the password instead.
function basicOk(header, token) {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const idx = decoded.indexOf(':');
  return idx !== -1 && equalTokens(decoded.slice(idx + 1), token);
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

export function createApi(db, token) {
  if (!token) throw new Error('STACK_API_TOKEN is required');

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/' && req.method === 'GET') {
      const auth = req.headers.authorization;
      if (!tokenOk(auth, token) && !basicOk(auth, token)) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="stack"' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(renderStatusPage(db));
    }

    if (!tokenOk(req.headers.authorization, token)) {
      return send(res, 401, { error: 'missing or invalid token' });
    }
    const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent);

    try {
      if (req.method === 'GET' && pathname === '/stacks') {
        return send(res, 200, ops.stacks(db));
      }
      if (seg[0] === 'stacks' && seg.length === 2 && req.method === 'GET') {
        return send(res, 200, ops.list(db, seg[1]));
      }
      if (seg[0] === 'stacks' && seg.length === 3 && req.method === 'GET' && seg[2] === 'history') {
        return send(res, 200, ops.history(db, seg[1]));
      }
      if (seg[0] === 'stacks' && seg.length === 3 && req.method === 'POST' && seg[2] === 'push') {
        const { title } = await readJson(req);
        if (typeof title !== 'string' || !title.trim()) {
          return send(res, 400, { error: 'body must be {"title": "..."}' });
        }
        return send(res, 201, ops.push(db, seg[1], title.trim(), API_ACTOR));
      }
      if (seg[0] === 'stacks' && seg.length === 3 && req.method === 'POST' && seg[2] === 'pop') {
        const task = ops.pop(db, seg[1], API_ACTOR);
        if (!task) return send(res, 409, { error: `stack ${seg[1]} is empty` });
        return send(res, 200, task);
      }
      if (seg[0] === 'tasks' && seg.length === 2) {
        const id = Number(seg[1]);
        if (req.method === 'GET') {
          const task = ops.getTask(db, id);
          return task ? send(res, 200, task) : send(res, 404, { error: `no task ${seg[1]}` });
        }
        if (req.method === 'DELETE') {
          const task = ops.rm(db, id, API_ACTOR);
          return task ? send(res, 200, task) : send(res, 404, { error: `no task ${seg[1]}` });
        }
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof SyntaxError) return send(res, 400, { error: 'invalid JSON body' });
      console.error(err);
      return send(res, 500, { error: 'internal error' });
    }
  });
}
