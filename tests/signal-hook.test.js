const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const signals = require('../lib/signals');

function withEventsDir(fn) {
  const dir = tmpDir();
  const prev = process.env.LIMITBAR_EVENTS_DIR;
  process.env.LIMITBAR_EVENTS_DIR = dir;
  delete require.cache[require.resolve('../lib/signal-hook')];
  try { return fn(dir); } finally {
    if (prev === undefined) delete process.env.LIMITBAR_EVENTS_DIR; else process.env.LIMITBAR_EVENTS_DIR = prev;
    rmDir(dir);
  }
}

test('appendEvent: cria a pasta e grava uma linha JSON', () => {
  withEventsDir((dir) => {
    const { appendEvent } = require('../lib/signal-hook');
    appendEvent('claude', 'stop', 123);
    const line = fs.readFileSync(path.join(dir, 'events.log'), 'utf8').trim();
    assert.deepEqual(JSON.parse(line), { svc: 'claude', kind: 'stop', ts: 123 });
  });
});

test('appendEvent: duas chamadas acrescentam, não substituem', () => {
  withEventsDir(() => {
    const { appendEvent } = require('../lib/signal-hook');
    appendEvent('claude', 'stop', 1);
    appendEvent('codex', 'turn-complete', 2);
    const events = signals.readNew(signals.eventsFile(), 0).events;
    assert.deepEqual(events, [{ svc: 'claude', kind: 'stop', ts: 1 }, { svc: 'codex', kind: 'turn-complete', ts: 2 }]);
  });
});

test('appendEvent: pasta sem permissão de escrita não lança', () => {
  const { appendEvent } = require('../lib/signal-hook');
  const prev = process.env.LIMITBAR_EVENTS_DIR;
  process.env.LIMITBAR_EVENTS_DIR = 'Z:\\caminho\\que\\nao\\existe\\de\\jeito\\nenhum';
  try { assert.doesNotThrow(() => appendEvent('claude', 'stop', 1)); }
  finally { if (prev === undefined) delete process.env.LIMITBAR_EVENTS_DIR; else process.env.LIMITBAR_EVENTS_DIR = prev; }
});
