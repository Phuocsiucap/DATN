// Isolated manual/browser smoke tests. Never proxies requests to the real API.
// Run from frontend/: node tests/review-ui-server.mjs
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const port = Number(process.env.REVIEW_UI_PORT || 5187)
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('../', import.meta.url)),
  cacheDir: 'node_modules/.vite-review-ui',
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  plugins: [react(), tailwindcss(), {
    name: 'isolated-review-smoke',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api')) {
          res.writeHead(403); res.end('Real API is disabled in this test server.'); return
        }
        const listTest = req.url?.startsWith('/__video-list-ui')
        const approvalsTest = req.url?.startsWith('/__approvals-ui')
        if (!listTest && !approvalsTest && !req.url?.startsWith('/__review-ui') && req.url !== '/generate-video/mock-workflow') return next()
        const app = approvalsTest ? 'approvals-ui-app' : listTest ? 'video-list-ui-app' : 'review-ui-app'
        const html = await vite.transformIndexHtml(req.url, `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Review UI — mock only</title></head><body><div id="root"></div><script type="module" src="/tests/${app}.jsx"></script></body></html>`)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Content-Security-Policy', `connect-src 'self' ws://localhost:${port}; img-src 'self' data:; media-src 'self' data:; font-src 'self' data:`)
        res.end(html)
      })
    },
  }],
  server: { host: 'localhost', port, strictPort: true },
})
await server.listen()
console.log(`Mock review UI: http://localhost:${port}/__review-ui (no real API, no paid calls)`)
