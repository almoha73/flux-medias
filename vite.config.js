import { defineConfig } from 'vite';

// Dev proxy to the news sites (RSS feeds and full articles), avoids CORS in the browser.
// /api/site/cnews/<path>   → https://www.cnews.fr/<path>
// /api/site/europe1/<path> → https://www.europe1.fr/<path>
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const site = (source, target) => ({
  [`/api/site/${source}`]: {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(`/api/site/${source}`, ''),
    // Europe 1 rejects non-browser user agents
    configure: (proxy) => proxy.on('proxyReq', (req) => req.setHeader('User-Agent', BROWSER_UA)),
  },
});

export default defineConfig({
  plugins: [],
  server: {
    proxy: {
      ...site('cnews', 'https://www.cnews.fr'),
      ...site('europe1', 'https://www.europe1.fr'),
    },
  },
});
