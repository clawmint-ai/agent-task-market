// Queue — seam for async, non-money work (notifications, cache refresh). beta
// uses an in-process queue; the commercial target swaps in Redis + BullMQ
// WITHOUT touching callers. Money/settlement flows go through WorkflowRunner,
// NOT this queue.

export type JobHandler<T> = (payload: T) => Promise<void>;

export interface Queue {
  enqueue<T>(topic: string, payload: T): Promise<void>;
  process<T>(topic: string, handler: JobHandler<T>): void;
}

/** beta: fire handlers in-process on nextTick. Lost on restart — fine for
 *  best-effort notifications, never for money. */
export class InProcQueue implements Queue {
  private handlers = new Map<string, JobHandler<any>>();

  async enqueue<T>(topic: string, payload: T): Promise<void> {
    const handler = this.handlers.get(topic);
    if (!handler) return;
    queueMicrotask(() => {
      void handler(payload).catch((err) => console.error(`[queue:${topic}]`, err));
    });
  }

  process<T>(topic: string, handler: JobHandler<T>): void {
    this.handlers.set(topic, handler as JobHandler<any>);
  }
}

let instance: Queue | null = null;
export function getQueue(): Queue {
  if (!instance) instance = new InProcQueue();
  return instance;
}
