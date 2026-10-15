/**
 * Vercel Edge Middleware: optional password for the whole site.
 *
 * In the Vercel project go to Settings → Environment Variables and add
 *   SITE_PASSWORD = the password you want to share
 *   SITE_USER     = optional username (defaults to "guest")
 * then redeploy. Visitors get the browser's own password prompt.
 * Leave SITE_PASSWORD unset and the site is public.
 */
export const config = { matcher: '/:path*' };

export default function middleware(request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return; // public site

  const user = process.env.SITE_USER || 'guest';
  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(':');
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (i > -1 && u === user && p === password) return; // let the request through
    } catch { /* malformed header: fall through to the prompt */ }
  }

  return new Response('This site needs a password.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Access Stills", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
