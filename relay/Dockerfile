# La PWA si costruisce sulla piattaforma del builder: produce file statici
# identici per ogni architettura, e Bun sotto emulazione arm64 sarebbe lento.
FROM --platform=$BUILDPLATFORM oven/bun:1.3-alpine AS web
WORKDIR /build
COPY relay/package.json relay/bun.lock relay/tsconfig.json ./
RUN bun install --frozen-lockfile
COPY project.inlang ./project.inlang
COPY messages ./messages
COPY src ./src
COPY relay ./relay
RUN ln -sf /build/node_modules /build/relay/node_modules
RUN bun --cwd relay run compile:i18n
RUN bun --cwd relay run build:web

FROM oven/bun:1.3-alpine
# Versione del relay mostrata da /healthz, Studio e PWA. Vuota = package.json.
ARG RELAY_VERSION=

WORKDIR /app
COPY relay/package.json relay/tsconfig.json ./
COPY relay/src ./src
COPY relay/public ./public
COPY --from=web /build/relay/web/dist ./web/dist

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
