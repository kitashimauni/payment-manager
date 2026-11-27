FROM node:26.13.1-bookworm-slim AS deps

WORKDIR /app

# Node.js 26 no longer bundles Corepack; install the pinned package manager.
RUN npm install --global pnpm@11.21.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder

COPY . .
ENV DOCKER_BUILD=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Drizzle Kit is a devDependency and is deliberately excluded from the runner.
FROM deps AS migrate

COPY drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY src/server/db/schema.ts ./src/server/db/schema.ts
COPY scripts/bootstrap-single-user.mjs ./scripts/bootstrap-single-user.mjs
CMD ["pnpm", "db:migrate"]

FROM node:26.13.1-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
