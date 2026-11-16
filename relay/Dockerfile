# La PWA si costruisce sulla piattaforma del builder: produce file statici
# identici per ogni architettura, e Bun sotto emulazione arm64 sarebbe lento.
FROM --platform=$BUILDPLATFORM oven/bun:1.3-alpine AS web
WORKDIR /build
# La PWA riusa moduli di `src/lib` che importano pacchetti del progetto
# principale (`@xterm/*`, `@tauri-apps/plugin-*`, `esbuild-wasm`): servono
# entrambi gli alberi di dipendenze, come in locale dove relay/node_modules
# convive con quello della radice.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY relay/package.json relay/bun.lock ./relay/
RUN cd /build/relay && bun install --frozen-lockfile
COPY project.inlang ./project.inlang
COPY messages ./messages
COPY src ./src
COPY relay ./relay
WORKDIR /build/relay
# Monaco e i componenti condivisi della GUI superano l'heap predefinito di
# Node: senza questo limite `vite build` muore con "JavaScript heap out of memory".
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN bun run build:web

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
