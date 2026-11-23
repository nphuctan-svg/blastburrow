FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts/build.mjs scripts/build.mjs
COPY src src
COPY public public
RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 BURROW_DB=/app/data/burrow.sqlite
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN install -d -o node -g node /app/data
USER node
EXPOSE 4317
CMD ["node", "dist/server/server.js"]
