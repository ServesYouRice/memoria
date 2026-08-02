import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  requestId: string;
}
const storage = new AsyncLocalStorage<RequestContext>();

const REQUEST_ID_PROVIDER_KEY = "__memoriaRequestIdProvider";
type RequestIdGlobal = typeof globalThis & {
  [REQUEST_ID_PROVIDER_KEY]?: () => string | undefined;
};
(globalThis as RequestIdGlobal)[REQUEST_ID_PROVIDER_KEY] = () =>
  storage.getStore()?.requestId;

export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
