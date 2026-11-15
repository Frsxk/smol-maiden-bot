# syntax=docker/dockerfile:1
FROM node:22-slim AS native-build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 pkg-config libcairo2-dev libpango1.0-dev \
    libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

FROM native-build AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json eslint.config.mjs ./
COPY src/ ./src/
RUN npm run build

FROM native-build AS production-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-slim AS production
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo \
    libgif7 librsvg2-2 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/package.json ./package.json
COPY --from=build /app/dist ./dist
USER node
RUN node -e "const assert = require('node:assert/strict'); const canvas = require('canvas').createCanvas(32, 32); canvas.getContext('2d').fillRect(0, 0, 32, 32); require('pet-pet-gif')(canvas.toBuffer('image/png')).then(gif => { assert.equal(gif.subarray(0, 6).toString(), 'GIF89a'); assert.ok(gif.length > 6); }).catch(error => { console.error(error); process.exitCode = 1; });"
CMD ["node", "dist/index.js"]
