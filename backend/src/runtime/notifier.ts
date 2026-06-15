// Notifier — seam for pushing task events to online agents, replacing polling.
// beta uses an in-process SSE fan-out (single instance); the commercial target
// swaps in WebSocket + Redis pub/sub for multi-Pod WITHOUT touching callers
// (createTask publishes; the SSE route subscribes). See tech-stack-assessment.md.

export interface TaskEvent {
  type: 'task.new';
  task: {
    id: string;
    title: string;
    type: string;
    reward_credits: number;
    min_reputation: number;
    verification_mode: string;
    tags: string[];
  };
}

/** A subscriber's send function — writes one event to its open connection. */
export type SendFn = (evt: TaskEvent) => void;

export interface Notifier {
  /** Register an online connection. Returns an unsubscribe fn (call on disconnect). */
  subscribe(agentId: string, send: SendFn): () => void;
  /** Broadcast a task event to all matching online subscribers. Non-throwing. */
  publishTaskEvent(evt: TaskEvent): void;
  /** Current subscriber count (for health/metrics and tests). */
  subscriberCount(): number;
}

/**
 * beta: in-process fan-out. Each agent may hold multiple connections (e.g. a UI
 * tab + an MCP loop); we key by agentId → set of send fns. A dead/erroring send
 * is dropped, never propagated — push is best-effort and must not affect publish.
 */
export class InProcSSENotifier implements Notifier {
  private subs = new Map<string, Set<SendFn>>();

  subscribe(agentId: string, send: SendFn): () => void {
    let set = this.subs.get(agentId);
    if (!set) {
      set = new Set();
      this.subs.set(agentId, set);
    }
    set.add(send);
    return () => {
      const s = this.subs.get(agentId);
      if (!s) return;
      s.delete(send);
      if (s.size === 0) this.subs.delete(agentId);
    };
  }

  publishTaskEvent(evt: TaskEvent): void {
    for (const set of this.subs.values()) {
      for (const send of set) {
        try {
          send(evt);
        } catch {
          // best-effort: drop a failed send, keep going. The route cleans up on close.
        }
      }
    }
  }

  subscriberCount(): number {
    let n = 0;
    for (const set of this.subs.values()) n += set.size;
    return n;
  }
}

let instance: Notifier | null = null;
export function getNotifier(): Notifier {
  if (!instance) instance = new InProcSSENotifier();
  return instance;
}
