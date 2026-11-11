# syntax=docker/dockerfile:1

# Node.js version used for building and running
# Must match .node-version (checked in CI)
ARG NODE_VERSION=26.13.0

# ---- base: pnpm and the manifests needed for installing dependencies ----
# The stages up to "deps" run on the build machine's platform even when building for another platform
# (e.g. linux/arm64 on an amd64 machine), because their outputs are platform-independent JavaScript.
# Only "runtime" uses the target platform, and it runs no commands, so no emulation is needed for building.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Install the pnpm version in the "packageManager" field of package.json (e.g. "pnpm@12.6.0")
# with npm instead of corepack, which is no longer bundled with Node.js 25 and later
RUN npm install -g "$(node -p "require('./package.json').packageManager.split('+')[0]")"

# ---- build: install all dependencies and build ./built ----
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsdown.config.ts ./
COPY src ./src
RUN pnpm build

# ---- deps: runtime dependencies only ----
# fastify is an optionalDependency, which "--prod" still installs
# (do not add "--no-optional", or the server cannot start)
# The runtime dependencies must stay free of native addons, because this stage runs on the build machine's platform
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

# ---- runtime ----
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
# Listen on all interfaces so that the server is reachable through a published port
ENV SUMMALY_HOST=0.0.0.0
ENV SUMMALY_PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/built ./built
COPY package.json LICENSE ./
USER node
EXPOSE 3000
CMD ["node", "built/server.js"]
