// Development builds only (see index.dev.ts): lets the e2e harness, and DevTools, call the request handlers
// from inside the worker, where runtime.sendMessage cannot reach its own listener.
import { checkRequest } from '../shared/validate';
import { handle } from './handlers';
import { enqueue, reload, setIdle } from './store';

(globalThis as unknown as { __ytbTest?: unknown }).__ytbTest = (type: string, payload: Record<string, unknown> = {}) =>
  enqueue(async (s) => {
    if (type === '_setIdle') {
      await setIdle(s, payload['idle'] as 'active' | 'idle' | 'locked');
      return { ok: true };
    }
    if (type === '_reloadForTest') {
      await reload();
      return { ok: true };
    }
    // The hook lives in the worker's own global, so it is as trusted as an extension page.
    const checked = checkRequest({ ...payload, type }, 'page');
    if ('error' in checked) throw new Error(checked.error);
    return handle(s, checked.req, {} as chrome.runtime.MessageSender);
  });
