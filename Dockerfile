# WCOIN.CASINO — single-process deploy (API + indexers + built SPA).
# better-sqlite3 is a native module, so we build with the toolchain present.
FROM node:20-bookworm-slim

WORKDIR /app

# build deps for better-sqlite3's native addon (node-gyp fallback)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# install ALL deps (build needs tsc/vite, runtime needs tsx/cross-env) — do this
# before NODE_ENV=production is set so dev deps are not skipped
COPY package.json package-lock.json ./
RUN npm ci

# app source + build the SPA (server runs the TS directly via tsx)
COPY . .
RUN npm run build

# runtime config. Railway injects $PORT; the DB lives on the mounted volume.
ENV NODE_ENV=production
ENV DB_PATH=/app/server/data/wcoin.db
# NOTE: do NOT set HTTP(S)_PROXY in the cloud — there is no GFW there; the
# collectors fetch the open web directly (net.ts degrades gracefully).

EXPOSE 8787
CMD ["npm", "start"]
