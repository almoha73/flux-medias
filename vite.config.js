import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  server: {
    proxy: {
      '/api/rss/cnews': {
        target: 'https://www.cnews.fr',
        changeOrigin: true,
        rewrite: () => '/rss.xml',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      },
      '/api/rss/europe1': {
        target: 'https://www.europe1.fr',
        changeOrigin: true,
        rewrite: () => '/rss.xml',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      }
    }
  }
});