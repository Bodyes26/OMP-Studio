# La PWA si costruisce sulla piattaforma del builder: produce file statici
# identici per ogni architettura, e Bun sotto emulazione arm64 sarebbe lento.
FROM --platform=$BUILDPLATFORM oven/bun:1.3-alpine AS web
WORKDIR /build
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src/protocol.ts ./src/protocol.ts
COPY web ./web
RUN bun run build:web

FROM oven/bun:1.3-alpine
# Versione del relay mostrata da /healthz, Studio e PWA. Vuota = package.json.
ARG RELAY_VERSION=

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public
COPY --from=web /build/web/dist ./web/dist

# Un volume nuovo eredita il proprietario della cartella dell'immagine:
# l'utente `bun` deve poter scrivere il database.
RUN mkdir -p /data && chown bun:bun /data

ENV NODE_ENV=production \
    RELAY_PORT=8787 \
    RELAY_DATA_DIR=/data \
    RELAY_VERSION=${RELAY_VERSION}

VOLUME ["/data"]
USER bun
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${RELAY_PORT}/healthz" >/dev/null || exit 1

CMD ["bun", "run", "src/server.ts"]
