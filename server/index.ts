import "./env-local";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createApp } from "./app";

(async () => {
  const app = await createApp();

  if (process.env.NODE_ENV === "development") {
    const metroProxy = createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
      ws: true,
      logger: undefined,
    });
    app.use((req: any, res: any, next: any) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
        return next();
      }
      return metroProxy(req, res, next);
    });
    console.log("Dev proxy: non-API requests forwarded to Metro on port 8081");
  }

  const port = parseInt(
    process.env.PORT || (process.env.NODE_ENV === "production" ? "8080" : "5000"),
    10
  );

  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on ${port} (PORT=${process.env.PORT || "default"})`);
  });

  // Reels use direct Bunny TUS; API no longer streams huge bodies. Default 10m is enough for DB / image / small API work.
  const socketMs = Math.max(
    30_000,
    parseInt(process.env.SERVER_SOCKET_TIMEOUT_MS || "600000", 10) || 600000,
  );
  server.timeout = socketMs;
  server.keepAliveTimeout = Math.min(socketMs, 65000);
  server.headersTimeout = socketMs + 1000;
})();
