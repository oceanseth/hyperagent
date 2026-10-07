# Build context: the web/ directory (docker build -f web/Dockerfile.app web)

# --- Stage 1: build the TanStack Start + Nitro SSR app ---
FROM node:24-slim AS build
WORKDIR /app

# Prisma's query engine needs OpenSSL present when the client is generated.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.4.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .

# Routes are pre-generated and committed; regenerate defensively if present.
RUN pnpm exec prisma generate
RUN if [ -d src/routes ]; then pnpm exec tsr generate || true; fi
RUN NITRO_PRESET=node_server pnpm run build

# --- Stage 2: runtime ---
FROM node:24-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/.output ./.output

ENV PORT=3000 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 3000
CMD ["node", "/app/.output/server/index.mjs"]
