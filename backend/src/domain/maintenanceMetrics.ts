// Maintenance-loop counters (block E). The periodic sweep already logs failures
// at log.error, but an ERROR line in a container nobody tails is not actionable:
// a stuck reclaim means publisher refunds are stranded, a stuck release means
// max_executors=1 tasks lock forever. These counters surface sweep outcomes on
// /metrics so the monitoring stack can ALERT on a rising failure count.
//
// Hand-rolled accumulator (same call as domain/httpMetrics.ts): minimal deps,
// in-process, render() is pure given the accumulated state so it's unit-testable
// without a server. Single-instance counters reset on restart — fine, Prometheus
// handles resets via rate()/increase().

type Task = 'reclaim' | 'release';
type Outcome = 'ok' | 'error';

export class MaintenanceMetrics {
  // key `${task}:${outcome}` → count of sweeps with that result.
  private readonly runs = new Map<string, number>();

  /** Record one sweep-task outcome (called once per task per sweep). */
  record(task: Task, outcome: Outcome): void {
    const key = `${task}:${outcome}`;
    this.runs.set(key, (this.runs.get(key) ?? 0) + 1);
  }

  /** Render Prometheus text. Seeds every task×outcome to 0 so a never-yet-failed
   *  counter still exists as a series (a missing series reads as "no data" and
   *  can't be alerted on). Pure given accumulated state. */
  render(): string {
    const lines: string[] = [
      '# HELP atm_maintenance_runs_total Maintenance sweep-task outcomes by task and result.',
      '# TYPE atm_maintenance_runs_total counter',
    ];
    for (const task of ['reclaim', 'release'] as Task[]) {
      for (const outcome of ['ok', 'error'] as Outcome[]) {
        const n = this.runs.get(`${task}:${outcome}`) ?? 0;
        lines.push(`atm_maintenance_runs_total{task="${task}",outcome="${outcome}"} ${n}`);
      }
    }
    return lines.join('\n') + '\n';
  }
}
