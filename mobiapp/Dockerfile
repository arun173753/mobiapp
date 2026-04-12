FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

RUN groupadd --system --gid 1001 appuser && useradd --system --uid 1001 --gid appuser appuser \
  && chown -R appuser:appuser /app
USER appuser

CMD ["node", "server.js"]
