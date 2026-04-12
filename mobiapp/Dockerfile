# Node 20 LTS (Debian bookworm slim) — matches package.json engines
FROM node:20-bookworm-slim

WORKDIR /app

# Fail fast on errors in any RUN
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV NODE_ENV=production
# Cloud Run sets PORT at runtime; default matches Cloud Run’s typical port
ENV PORT=8080
ENV NPM_CONFIG_LOGLEVEL=info
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_AUDIT=false

# Install dependencies (lockfile must be committed and in sync with package.json)
COPY package.json package-lock.json ./
RUN set -euxo pipefail \
  && npm ci --omit=dev

COPY server.js ./
RUN set -euxo pipefail \
  && npm run build

EXPOSE 8080

# Official image includes user "node" (uid 1000); avoid useradd/groupadd (can fail on minimal images)
RUN chown -R node:node /app
USER node

CMD ["npm", "start"]
