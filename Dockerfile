FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY patches/ ./patches/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server_dist/ ./server_dist/
COPY shared/ ./shared/
COPY server/templates/ ./server/templates/
COPY app.json ./

# static-build / assets are optional at runtime (server checks existsSync)
RUN mkdir -p uploads static-build assets

ENV NODE_ENV=production
ENV PORT=8080
ENV SERVER_SOCKET_TIMEOUT_MS=600000

EXPOSE 8080

CMD ["node", "server_dist/index.js"]

