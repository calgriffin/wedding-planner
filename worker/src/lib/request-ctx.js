// The Worker's ExecutionContext for each request, so a route handler can
// keep work running (ctx.waitUntil) if the browser goes away mid-reply.
// Keyed on the Request object, which the fetch handler passes unchanged to
// every route handler; requests made in-process (dispatchInternal) have none.

const contexts = new WeakMap();

export function rememberContext(request, ctx) {
  if (request && ctx && typeof ctx.waitUntil === 'function') contexts.set(request, ctx);
}

export function keepAlive(request, promise) {
  const ctx = contexts.get(request);
  if (ctx) ctx.waitUntil(promise.catch(() => {}));
  return promise;
}
