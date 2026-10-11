// A stand-in for Sala's website, for the update check in the browser demo and the
// screenshots: it serves the file that names the latest version, and nothing else.
export function createWebsiteMock(opts: { latestVersion?: string }): (url: string, init?: RequestInit) => Promise<Response | null> {
  return async (url, init) => {
    const u = new URL(url);
    if (u.host !== 'sala.thehumanloop.eu') return null;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && u.pathname === '/downloads/manifest.json') {
      const body = { product: 'Sala', version: opts.latestVersion ?? '0.1.0', published: '2026-09-30T11:54:05Z', files: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: u.pathname, retry_after_seconds: null } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
}
