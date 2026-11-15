import type { MiddlewareHandler } from 'hono';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** What a web page of another site can send to this server without asking the browser's permission first. */
const SIMPLE_TYPES = new Set(['', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']);

/**
 * The guard in front of every route. The server listens on 127.0.0.1 only, but a page open in the browser can still
 * reach it, so two things are refused here:
 * - a request whose Host is not this machine (DNS rebinding makes a remote name point at 127.0.0.1);
 * - a request that changes something, unless the browser would have had to ask permission to send it: it carries
 *   the `x-afk-action` header, or a content type that is not one of the "simple" ones a page may send blindly.
 *   `c.req.json()` ignores the content type, so a text/plain body would otherwise be read as JSON.
 */
export const requestGuard: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host');
  if (host !== undefined && !LOCAL_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase())) return c.json({ error: 'Unknown host' }, 403);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!c.req.header('x-afk-action') && SIMPLE_TYPES.has(type)) return c.json({ error: 'Do this from the app' }, 400);
  }
  await next();
};
