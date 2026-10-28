# Imagen de la API y del worker (mismo código; el comando decide qué corre).
# Contexto de build: la raíz del repositorio.  docker build -f apps/api/Dockerfile -t crm-api .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm -F @crm/shared build && pnpm -F @crm/api build

FROM node:22-alpine
RUN corepack enable && apk add --no-cache openssl tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data/storage && chown -R node:node /data /app/apps/api
USER node
ENV STORAGE_DIR=/data/storage API_PORT=3001
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/v1/health/ready || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# API por defecto; el worker usa: node dist/worker.js
CMD ["node", "dist/main.js"]
