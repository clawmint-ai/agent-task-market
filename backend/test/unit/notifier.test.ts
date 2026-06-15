import { test } from 'node:test';
import assert from 'node:assert';
import { InProcSSENotifier, TaskEvent } from '../../src/runtime/notifier';

const evt = (type = 'code'): TaskEvent => ({
  type: 'task.new',
  task: {
    id: 'task-1', title: 'x', type, reward_credits: 10,
    min_reputation: 0, verification_mode: 'auto_rules', tags: [],
  },
});

test('subscriber receives published events', () => {
  const n = new InProcSSENotifier();
  const got: TaskEvent[] = [];
  n.subscribe('agent-1', (e) => got.push(e));
  n.publishTaskEvent(evt());
  assert.equal(got.length, 1);
  assert.equal(got[0].task.id, 'task-1');
});

test('unsubscribe stops delivery and cleans up', () => {
  const n = new InProcSSENotifier();
  const got: TaskEvent[] = [];
  const off = n.subscribe('agent-1', (e) => got.push(e));
  off();
  n.publishTaskEvent(evt());
  assert.equal(got.length, 0);
  assert.equal(n.subscriberCount(), 0);
});

test('fan-out to multiple subscribers', () => {
  const n = new InProcSSENotifier();
  let a = 0, b = 0;
  n.subscribe('agent-1', () => a++);
  n.subscribe('agent-2', () => b++);
  n.publishTaskEvent(evt());
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(n.subscriberCount(), 2);
});

test('a throwing subscriber does not break others (best-effort)', () => {
  const n = new InProcSSENotifier();
  let ok = 0;
  n.subscribe('bad', () => { throw new Error('boom'); });
  n.subscribe('good', () => { ok++; });
  assert.doesNotThrow(() => n.publishTaskEvent(evt()));
  assert.equal(ok, 1);
});

test('one agent can hold multiple connections', () => {
  const n = new InProcSSENotifier();
  let c = 0;
  const off1 = n.subscribe('agent-1', () => c++);
  n.subscribe('agent-1', () => c++);
  n.publishTaskEvent(evt());
  assert.equal(c, 2);
  off1();
  assert.equal(n.subscriberCount(), 1); // one connection remains
});
