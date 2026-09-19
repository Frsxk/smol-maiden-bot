# syntax=docker/dockerfile:1
FROM node:22-slim AS build

WORKDIR /app

# Create non-root user (adduser is bundled in slim images)
RUN addgroup --system smolmaiden && adduser --system --ingroup smolmaiden smolmaiden

# ---- Dependencies stage ----
FROM build AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Production stage ----
FROM build AS production
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

COPY commands/ ./commands/
COPY events/ ./events/
COPY handler/ ./handler/
COPY slashCmds/ ./slashCmds/
COPY src/ ./src/
COPY config.js ./
COPY index.js ./

RUN chown -R smolmaiden:smolmaiden /app

USER smolmaiden

# Verify the runtime can load the core dependency
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "require('discord.js')" || exit 1

CMD ["node", "index.js"]
