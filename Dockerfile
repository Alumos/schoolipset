FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig*.json vite.config.ts tailwind.config.ts postcss.config.cjs index.html ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=18080 \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=18081 \
    DB_PATH=/data/schoolipset.sqlite

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 18080 18081
VOLUME ["/data"]
CMD ["node", "dist/server/index.js"]
