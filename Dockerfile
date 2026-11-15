# syntax=docker/dockerfile:1

# ---- Build: compile TypeScript ----------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Production dependencies only -------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- Runtime ----------------------------------------------------------------
FROM node:24-alpine AS runtime
# tini forwards stop signals so the server shuts down gracefully.
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production \
    TZ=Europe/Tirane \
    PORT=3000

# Files stay owned by root and read-only for the app user, so a compromised
# process cannot modify its own code.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
