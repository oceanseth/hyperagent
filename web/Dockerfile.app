# Build context: the web/ directory (docker build -f web/Dockerfile.app web)

# --- Stage 1: build the TanStack Start + Nitro SSR app ---
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Routes are pre-generated and committed; regenerate defensively if present.
RUN if [ -d src/routes ]; then npx tsr generate || true; fi
RUN NITRO_PRESET=node_server npm run build

# --- Stage 2: runtime ---
FROM node:22-slim
WORKDIR /app

COPY --from=build /app/.output ./.output

ENV PORT=3000 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 3000
CMD ["node", "/app/.output/server/index.mjs"]
