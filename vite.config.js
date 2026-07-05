import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const VITE_PORT = 5173;
const FLASK_TARGET = process.env.REACT_APP_PROXY_TARGET || 'http://127.0.0.1:1000';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['REACT_APP_', 'VITE_']);
  const processEnvDefine = Object.fromEntries(
    [
      ['NODE_ENV', mode],
      ['REACT_APP_API_URL', env.REACT_APP_API_URL || ''],
      ['REACT_APP_PROXY_TARGET', env.REACT_APP_PROXY_TARGET || FLASK_TARGET],
      ['REACT_APP_MARKET', env.REACT_APP_MARKET || ''],
      ['REACT_APP_CURRENCY', env.REACT_APP_CURRENCY || ''],
      ['REACT_APP_GUEST_MANAGER_WHATSAPP', env.REACT_APP_GUEST_MANAGER_WHATSAPP || ''],
    ].map(([key, val]) => [`process.env.${key}`, JSON.stringify(val)]),
  );

  return {
    plugins: [react({ include: /\.(jsx|js|tsx|ts)$/ })],
    resolve: {
      extensions: ['.jsx', '.js', '.json', '.tsx', '.ts'],
    },
    envPrefix: ['REACT_APP_', 'VITE_'],
    define: processEnvDefine,
    server: {
      host: '127.0.0.1',
      port: VITE_PORT,
      strictPort: true,
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: VITE_PORT,
        clientPort: VITE_PORT,
      },
      proxy: {
        '/api': {
          target: FLASK_TARGET,
          changeOrigin: true,
          ws: false,
          configure: (proxy) => {
            proxy.on('upgrade', (_req, socket) => {
              socket.destroy();
            });
          },
        },
        '/socket.io': {
          target: FLASK_TARGET,
          changeOrigin: true,
          ws: false,
          configure: (proxy) => {
            proxy.on('upgrade', (_req, socket) => {
              socket.destroy();
            });
          },
        },
      },
    },
  };
});
