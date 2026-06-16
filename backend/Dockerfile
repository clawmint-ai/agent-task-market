# ── Build stage: compile TypeScript to dist/ ────────────────────────────────
FROM node:20-bullseye-slim AS builder
WORKDIR /app
COPY package*.json ./
# Full install (incl. devDeps like typescript) for the build only.
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# tsc + copies schema.pg.sql into dist/db (see package.json "build").
RUN npm run build

# ── Runtime stage: production deps + compiled output only ───────────────────
FROM node:20-bullseye-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# python3 + pytest are needed for auto_tests verification in LOCAL sandbox mode.
# In production SANDBOX_MODE=docker is enforced (untrusted code runs in an
# isolated container, not here), but we keep the interpreter so trusted/local
# runs work out of the box. (pg is pure-JS — no native build tools needed.)
#
# docker CLI (client only, not the daemon): docker-mode spawns sandbox
# containers on the HOST daemon via the mounted /var/run/docker.sock, so the
# backend needs the `docker` binary to talk to it. Pinned static client; no
# engine/containerd is installed here.
ARG DOCKER_CLI_VERSION=27.3.1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip curl ca-certificates && \
    pip3 install --no-cache-dir pytest && \
    curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" \
      | tar -xzC /usr/local/bin --strip-components=1 docker/docker && \
    docker --version && \
    apt-get purge -y curl && apt-get autoremove -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
# Production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Compiled JS + static UI.
COPY --from=builder /app/dist ./dist
COPY public ./public
# Run as the unprivileged user that ships with the node image.
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
