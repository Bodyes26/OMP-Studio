# OMP Studio relay

[Italiano](README.it.md)

The relay lets you follow and drive your OMP Studio machines from a phone, a browser or another Studio without opening any port on them: each Studio connects out to the relay, and so do your devices. The relay also serves the remote dashboard, a PWA you can add to your phone's home screen.

There is no shared or default relay. You host your own, Studio asks for its address, and only the machines and devices you pair can use it.

## What the dashboard does

- Shows every paired machine, online or with its last known state: projects, lanes, agent activity, queued and scheduled tasks, quotas.
- Answers the agent's questions.
- Starts a queued task after showing you its full prompt.
- Waits for a quota reset or dismisses a quota block.
- Opens chats and sends prompts using the GUI's actual editor, role, model, reasoning and context-window components.
- Attaches files and images using the picker, clipboard or drag and drop; files are uploaded to the lane's host, not read from local paths on the phone.

Generic attachments support up to 50 MiB each and are transferred in chunks. Images use the same preparation as the GUI; text and images must fit the RPC command budget (700,000 characters combined before the envelope). If that limit is exceeded or sending fails, the composer keeps the draft. Remote history includes image previews only in small live updates; reloading history retains the image count.

Visual previews appear as cards in chat: open Mermaid diagrams, SVGs and HTML/TSX prototypes beside the conversation on desktop or full screen on phones. Diagrams support drag, pinch and zoom controls. This requires an updated Studio host advertising the `artifacts` feature and an updated relay/PWA; the phone never connects to the host's loopback preview server. Prototype documents are stored temporarily in relay memory (up to two hours); reopening republishes them.

## Requirements

- A server reachable from the internet, with Docker and Docker Compose.
- A DNS name pointing to it.
- A reverse proxy that terminates TLS and forwards WebSockets (Nginx Proxy Manager, Caddy, Traefik, plain nginx).

## Install

1. On the server, create a folder (for example `/opt/stacks/studio-relay`) and put in it this folder's `compose.example.yml` as `compose.yaml` and `.env.example` as `.env`.
2. Fill `.env`:
   - `RELAY_ADMIN_TOKEN`: a random secret, for example `openssl rand -hex 32`. Keep it private: it pairs your first device and opens the diagnostics page.
   - `PROXY_NETWORK`: the Docker network of your reverse proxy container (`docker network ls`).
3. Start it with `docker compose up -d`. It pulls `ghcr.io/bodyes26/omp-studio-relay:latest`; data lives in the `relay-data` volume. The container publishes no port: the reverse proxy reaches it as `studio-relay:8787` on the shared network.
4. In the reverse proxy, route your DNS name to `http://studio-relay:8787` with TLS and WebSocket support:
   - **Nginx Proxy Manager:** scheme `http`, forward hostname `studio-relay`, port `8787`, *Websockets Support* on; in the SSL tab a certificate for the name and *Force SSL*.
   - **Caddy:**
     ```
     relay.example.com {
         reverse_proxy studio-relay:8787
     }
     ```
5. Check:
   - `https://relay.example.com/healthz` returns the relay version and the protocol range it accepts;
   - `https://relay.example.com/diag`: paste the admin token and leave the page open. The connection should stay up, with a server heartbeat every 25 seconds.

## Pairing

1. **First device.** Open `https://relay.example.com` on your phone, enter a name for the device, choose *Use admin secret* and paste `RELAY_ADMIN_TOKEN`. On iPhone, *Share > Add to Home Screen* installs the dashboard as an app.
2. **More devices.** In the dashboard, *Settings > Add a device* shows a code valid for 10 minutes; enter it on the new device.
3. **Machines.** *Settings > Pair a machine* shows a code. In Studio open *Settings > Remote control*, enter the relay address, a name for the machine and the code, then *Pair*. Each machine keeps its name everywhere, so you always know where something runs.

Lost a device or retired a machine? Revoke it from *Settings*: its connections close immediately.

## Web Push notifications

The relay sends native Web Push notifications (RFC 8291 aes128gcm payload encryption, RFC 8292 VAPID) to paired devices when:
- An agent asks a question or asks for confirmation (`<machine> · <project>: domanda`).
- A lane gets blocked by quota.
- An agent in a lane finishes work (transitions to idle, with debounce against flapping).

Push notifications require HTTPS.
- On **Android / desktop Chrome / Firefox / Safari**, enable notifications from *Settings* in the dashboard.
- On **iOS / iPadOS (16.4+)**, Apple requires installing the PWA to the Home Screen (*Share > Add to Home Screen*) before Web Push can be activated.
- VAPID keys are generated automatically on first start and persisted in the SQLite database (`data/relay.db`), surviving container restarts.
- Devices with an active client window currently visible do not receive push notifications to avoid redundant alerts.
- Endpoints are strictly validated against an allowlist of legitimate push services (`fcm.googleapis.com`, `android.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`) both at subscription time and at delivery time, and requests do not follow HTTP redirects (`redirect: 'error'`), preventing SSRF attacks.

## Updating

```sh
docker compose pull && docker compose up -d
```

Your stack manager's update button does the same. Images: `latest` and `X.Y.Z` follow stable releases, `nightly` follows the main branch.

New features are negotiated: an older relay simply hides the commands it does not know. When a release changes the protocol, the relay keeps accepting the previous version for at least one stable release, so machines updated at different times stay connected. Studio's *Remote control* settings show the relay version and, if versions do not match, say whether the relay or Studio needs updating.

The relay never updates itself: it would need the Docker socket, which is administrator access to your server.

## Build from source

Clone the entire repository: the build includes shared `src/lib` components and compiles Paraglide messages. With `compose.yaml` inside `relay/`, comment out `image` and use `build: { context: .., dockerfile: relay/Dockerfile }`, then run `docker compose up -d --build`. Context paths are relative to the Compose file, not the terminal's working directory: if you keep Compose elsewhere, set `context` to the root of your clone. Add `--build-arg RELAY_VERSION=<version>` to label the build.

## Security notes

- Pairing codes are 8 characters, single use, valid for 10 minutes, and pairing attempts are rate-limited. A code issued by a device stops working when that device is revoked.
- Device sessions are `HttpOnly`, `SameSite=Strict` cookies; every state change checks the request origin.
- A machine credential can only publish that machine's state and receive its commands: it cannot read other machines or send commands.
- Rotating `RELAY_ADMIN_TOKEN` (edit `.env`, then `docker compose up -d`) does not unpair anything.
- There is no end-to-end encryption: the relay sees the state of your projects and the answers you send. Host it on a server you trust.
- An access layer in front of the relay, such as Cloudflare Access, is optional. If you add one, keep `/v1/host` reachable for Studio, which authenticates with its own credential.
- Behind a CDN, proxied WebSockets work: the 25-second heartbeat stays below common idle timeouts (100 seconds on Cloudflare).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `RELAY_ADMIN_TOKEN` | required, at least 32 characters | Owner secret: first pairing and diagnostics. |
| `RELAY_PORT` | `8787` | Port inside the container. |
| `RELAY_HOSTNAME` | `0.0.0.0` | Listen address inside the container. |
| `RELAY_DATA_DIR` | `/data` in the image, `./data` from source | SQLite database folder. |
| `RELAY_WEB_DIR` | the PWA built into the image | Folder of the dashboard files. |
| `RELAY_VERSION` | set at image build, else `package.json` | Version shown by `/healthz`, Studio and the dashboard. |
| `PROXY_NETWORK` | required by `compose.example.yml` | Docker network shared with the reverse proxy. |

## Development

```sh
bun install
bun test
bun run check && bun run check:web
bun run build:web
RELAY_ADMIN_TOKEN=$(openssl rand -hex 32) bun run start   # http://localhost:8787
bun run dev:web                                           # dashboard with hot reload, proxied to :8787
```
