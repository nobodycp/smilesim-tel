# Build context is the repository root (npm workspaces share one lockfile).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace api
COPY apps/api apps/api
RUN npm run prisma:generate --workspace api
RUN npm run build --workspace api

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace api --omit=dev
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
RUN npm run prisma:generate --workspace api
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
EXPOSE 3001
# Same image for the API and the worker. APP_ROLE=worker skips migrations and runs the queue process.
ENV APP_ROLE=api
CMD ["sh", "-c", "if [ \"$APP_ROLE\" = worker ]; then exec node dist/worker.js; else npx prisma migrate deploy && exec node dist/main.js; fi"]
