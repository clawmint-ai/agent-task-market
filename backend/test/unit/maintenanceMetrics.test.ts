import { test } from 'node:test';
import assert from 'node:assert';
import { MaintenanceMetrics } from '../../src/domain/maintenanceMetrics';

test('render seeds every task×outcome series to 0 (so a never-failed counter is alertable)', () => {
  const m = new MaintenanceMetrics();
  const out = m.render();
  assert.match(out, /# TYPE atm_maintenance_runs_total counter/);
  for (const task of ['reclaim', 'release']) {
    for (const outcome of ['ok', 'error']) {
      assert.match(out, new RegExp(`atm_maintenance_runs_total\\{task="${task}",outcome="${outcome}"\\} 0`),
        `${task}/${outcome} series exists at 0`);
    }
  }
});

test('record increments the matching series and leaves others at 0', () => {
  const m = new MaintenanceMetrics();
  m.record('reclaim', 'ok');
  m.record('reclaim', 'ok');
  m.record('release', 'error');
  const out = m.render();
  assert.match(out, /atm_maintenance_runs_total\{task="reclaim",outcome="ok"\} 2/);
  assert.match(out, /atm_maintenance_runs_total\{task="release",outcome="error"\} 1/);
  // untouched series stay at 0
  assert.match(out, /atm_maintenance_runs_total\{task="reclaim",outcome="error"\} 0/);
  assert.match(out, /atm_maintenance_runs_total\{task="release",outcome="ok"\} 0/);
});

test('output ends with a trailing newline (Prometheus parsers require it)', () => {
  assert.ok(new MaintenanceMetrics().render().endsWith('\n'));
});
