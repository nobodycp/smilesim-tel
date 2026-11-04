# Build context is the repository root (npm workspaces share one lockfile).
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace web
COPY apps/web apps/web

# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
RUN node ../../node_modules/next/dist/bin/next build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
