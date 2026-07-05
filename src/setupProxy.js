const { createProxyMiddleware } = require('http-proxy-middleware');

const FLASK_TARGET = process.env.REACT_APP_PROXY_TARGET || 'http://127.0.0.1:1000';

module.exports = function setupProxy(app) {
  // HMR uses /ws on the CRA dev server (:3000) — never proxy it to Flask.
  app.use('/ws', (_req, _res, next) => next());

  app.use(
    '/api',
    createProxyMiddleware({
      target: FLASK_TARGET,
      changeOrigin: true,
      logLevel: 'warn',
    }),
  );

  // Polling-only on the client; no ws upgrade proxy (avoids stray /ws → Flask).
  app.use(
    '/socket.io',
    createProxyMiddleware({
      target: FLASK_TARGET,
      changeOrigin: true,
      ws: false,
      logLevel: 'warn',
    }),
  );
};
