import type { HookEventMap, HookEventName, HookHandler, HooksConfig } from './types.js';

/**
 * Dispatches before/after mutation hooks to registered handlers.
 * Callers should check hasListeners before building expensive payloads (lazy load).
 */
export class HookDispatcher {
  private readonly handlers = new Map<HookEventName, Set<HookHandler<HookEventName>>>();

  constructor(config?: HooksConfig) {
    if (!config) return;
    for (const [event, handlerOrList] of Object.entries(config) as Array<
      [HookEventName, HookHandler<HookEventName> | Array<HookHandler<HookEventName>> | undefined]
    >) {
      if (!handlerOrList) continue;
      const list = Array.isArray(handlerOrList) ? handlerOrList : [handlerOrList];
      for (const handler of list) {
        this.on(event, handler);
      }
    }
  }

  on<E extends HookEventName>(event: E, handler: HookHandler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as HookHandler<HookEventName>);
    return () => this.off(event, handler);
  }

  off<E extends HookEventName>(event: E, handler: HookHandler<E>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as HookHandler<HookEventName>);
    if (set.size === 0) {
      this.handlers.delete(event);
    }
  }

  hasListeners(event: HookEventName): boolean {
    const set = this.handlers.get(event);
    return !!set && set.size > 0;
  }

  /**
   * Invoke all handlers for an event with the same payload (built once by the caller).
   * Handlers run sequentially; the first throw aborts.
   */
  async emit<E extends HookEventName>(event: E, payload: HookEventMap[E]): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      await (handler as HookHandler<E>)(payload);
    }
  }
}
