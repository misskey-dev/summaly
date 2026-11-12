# syntax=docker/dockerfile:1

# Node.js version used for building and running
# Must match .node-version (checked in CI)
ARG NODE_VERSION=26.13.1

# ---- build: install all dependencies and build the server bundle ----
# Runs on the build machine's platform even when building for another platform (e.g. linux/arm64 on an amd64
# machine), because its output is platform-independent JavaScript. Only "runtime" uses the target platform,
# and it runs no commands, so no emulation is needed for building.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Install the pnpm version in the "packageManager" field of package.json (e.g. "pnpm@12.6.0")
# with npm instead of corepack, which is no longer bundled with Node.js 25 and later
RUN npm install -g "$(node -p "require('./package.json').packageManager.split('+')[0]")"
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsdown.config.ts ./
COPY src ./src
RUN pnpm build

# ---- runtime ----
# built-server/ bundles every dependency (fastify included), so no node_modules is needed:
# server.mjs, the chunks it loads on demand (cheerio, for Amazon pages) and THIRD-PARTY-LICENSES.txt with their licenses.
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
# Listen on all interfaces so that the server is reachable through a published port
ENV SUMMALY_HOST=0.0.0.0
ENV SUMMALY_PORT=3000
WORKDIR /app
COPY --from=build /app/built-server/ ./
COPY LICENSE ./
USER node
EXPOSE 3000
HEALTHCHECK CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.SUMMALY_PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.mjs"]
