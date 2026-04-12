const { getDefaultConfig } = require("expo/metro-config");
const { createProxyMiddleware } = require("http-proxy-middleware");

const config = getDefaultConfig(__dirname);

// Block bun/eas-cli caches from being watched — they contain RN Android source
// and exhaust inotify file watcher limits on Linux
config.resolver = config.resolver || {};
config.resolver.blockList = [
  /\.cache\/.bun\/.*/,
  /\.cache\/eas-cli\/.*/,
];

const apiProxy = createProxyMiddleware({
  target: "http://localhost:5000",
  changeOrigin: true,
  ws: true,
  logger: undefined,
});

config.server = {
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url && (req.url.startsWith("/api/") || req.url.startsWith("/socket.io/") || req.url.startsWith("/uploads/"))) {
        return apiProxy(req, res, next);
      }
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
