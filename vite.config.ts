import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { defineConfig, type Connect, type Plugin } from 'vite'

// Serves the sibling data repos at /data/<net>/ during dev and preview, so the app reads them the
// same way it will read the published repos later.
function dataRepos(): Plugin {
  const dirs: Record<string, string> = {
    calibnet: resolve(process.env.DATA_DIR_CALIBNET ?? '../filecoin-sector-spiegel-data-calibration'),
    mainnet: resolve(process.env.DATA_DIR_MAINNET ?? '../filecoin-sector-spiegel-data-main'),
  }
  const serve: Connect.NextHandleFunction = async (req, res, next) => {
    const match = /^\/data\/(calibnet|mainnet)\/([\w./-]+\.json)$/.exec((req.url ?? '').split('?')[0])
    if (!match) return next()
    const root = dirs[match[1]]
    const file = resolve(root, match[2])
    if (!file.startsWith(root + sep)) {
      res.statusCode = 403
      return res.end()
    }
    try {
      const body = await readFile(file)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-cache')
      res.end(body)
    } catch {
      res.statusCode = 404
      res.end()
    }
  }
  return {
    name: 'data-repos',
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; local dev and preview stay at the root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), dataRepos()],
})
