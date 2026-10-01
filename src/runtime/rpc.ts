// Typed request helper over chrome.runtime.sendMessage (content scripts and extension pages).
import type { Request, RequestMap, RequestType, Response } from '../shared/messages';

export async function request<T extends RequestType>(type: T, payload: RequestMap[T]['req']): Promise<Response<T>> {
  // `type` goes last: a payload must never be able to choose which handler runs.
  const msg = { ...payload, type } as Request<T>;
  const res = (await chrome.runtime.sendMessage(msg)) as Response<T> | { error: string } | undefined;
  if (res === undefined) throw new Error(`no response for ${type}`);
  if (typeof res === 'object' && res !== null && 'error' in res && typeof (res as { error: unknown }).error === 'string') {
    throw new Error((res as { error: string }).error);
  }
  return res as Response<T>;
}
