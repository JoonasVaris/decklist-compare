import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves netlify/functions/*.ts inside the Vite dev server, so `npm run dev`
 * is enough to run the whole app locally (no Netlify CLI needed).
 * Handles both /api/<name> (the production redirect, see netlify.toml) and
 * /.netlify/functions/<name>. Functions are loaded through Vite's SSR module
 * loader, so edits to them hot-reload.
 */
function netlifyFunctionsDev(): Plugin {
  return {
    name: 'netlify-functions-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const m = url.pathname.match(/^\/(?:api|\.netlify\/functions)\/([A-Za-z0-9_-]+)\/?$/);
        if (!m) return next();
        try {
          const mod = await server.ssrLoadModule(`/netlify/functions/${m[1]}.ts`);
          const out = await mod.handler(
            {
              httpMethod: req.method,
              path: url.pathname,
              queryStringParameters: Object.fromEntries(url.searchParams),
              headers: req.headers,
            },
            {},
          );
          res.writeHead(out.statusCode ?? 200, out.headers ?? {});
          res.end(out.body ?? '');
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Function ${m[1]} failed: ${(err as Error).message}` }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), netlifyFunctionsDev()],
});
