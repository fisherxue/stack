import * as ops from './ops.js';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// One server-rendered read-only page: every stack, its tasks, recent history.
export function renderStatusPage(db) {
  const stacks = ops.stacks(db);
  const stackSections = stacks.length
    ? stacks
        .map(({ name, count }) => {
          const items = ops
            .list(db, name)
            .map((t) => `<li>${esc(t.title)}</li>`)
            .join('');
          return `<section><h2>${esc(name)} <small>(${count})</small></h2><ol>${items}</ol></section>`;
        })
        .join('')
    : '<p>no stacks</p>';

  const events = ops.allHistory(db);
  const symbol = { push: '+', pop: '−', rm: '×' };
  const historyRows = events
    .map(
      (e) =>
        `<tr><td>${esc(e.ts.slice(0, 16).replace('T', ' '))}</td>` +
        `<td>${symbol[e.type] ?? '?'}</td>` +
        `<td>${esc(e.stack)}</td><td>${esc(e.payload.title)}</td>` +
        `<td>${esc(e.actor)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>stack</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
  h2 small { color: #888; font-weight: normal; }
  ol { margin: 0 0 1.5rem; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 0.15rem 0.5rem 0.15rem 0; color: #444; }
  td:first-child { color: #888; white-space: nowrap; }
</style>
<h1>stack</h1>
${stackSections}
<h2>history</h2>
<table>${historyRows || '<tr><td>none</td></tr>'}</table>
`;
}
