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
    console.log(`express server serving on port ${port}`);
  });

  server.timeout = 30 * 60 * 1000;
  server.keepAliveTimeout = 30 * 60 * 1000;
  server.headersTimeout = 31 * 60 * 1000;
})();
