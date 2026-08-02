# Spotter local and staging playbook

This playbook starts the complete no-auth Spotter V1 with synthetic data and gives a tester or
developer a repeatable hands-on E2E path. PostgreSQL with pgvector and the coach web/API run in
Docker. The Expo client runs locally so it can target web, iOS Simulator, or Android Emulator.

## Safety boundary

Spotter V1 is intentionally no-auth and synthetic-only. Do not expose this stack to the public
internet and do not load real client data. The committed recorded-model mode needs no AI provider
credentials.

## Prerequisites

- Docker Desktop with Compose v2
- Node.js `24.11.1` (see `.node-version`)
- Corepack enabled
- At least 8 GB of free disk space for clean image builds and browser evidence

```bash
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

## Start the Docker stack

Create a local environment file once. The defaults are local-only synthetic credentials.

```bash
cp .env.example .env
```

Build and start PostgreSQL/pgvector, migrations, deterministic demo seed, and the hardened coach
web/API image:

```bash
docker compose --profile demo up --build --detach --wait postgres migrate seed web
```

Confirm every long-running service is healthy and both health contracts answer:

```bash
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:3000/health/live
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/clients
```

Open the coach console at [http://127.0.0.1:3000/queue](http://127.0.0.1:3000/queue).

## Start the Expo client

For the browser-based mobile viewport:

```bash
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000 \
  pnpm --filter @spotter/client-frontend dev -- --web --port 8081
```

Open [http://127.0.0.1:8081](http://127.0.0.1:8081) and use a 390 × 844 responsive viewport.

For iOS Simulator, use the same API URL and start Expo without `--web`:

```bash
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000 \
  pnpm --filter @spotter/client-frontend dev -- --clear
```

For Android Emulator, use its host-loopback alias:

```bash
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000 \
  pnpm --filter @spotter/client-frontend dev -- --clear
```

The default Docker port is bound to `127.0.0.1`; a physical phone therefore needs an explicitly
reviewed LAN/staging endpoint rather than the local defaults.

## Hands-on E2E acceptance path

1. In the client app, select one of the seven synthetic clients and confirm the Today screen never
   exposes a queued or rejected programme.
2. In the coach console, open the review queue, inspect a programme, its constraints, citations,
   safety gates, judge results, and context trace.
3. Approve a clear candidate. For a blocked candidate, confirm ordinary approval fails closed and a
   reasoned coach override is required.
4. Refresh the client Today screen and confirm only the newly published programme appears.
5. Submit a daily check-in, including free text, then confirm it is present in the next exact
   context trace visible to the coach.
6. Open a scheduled session, log actual work and RPE, complete it, and confirm it appears in History
   while an unfinished planned session does not.
7. Review the coach scorecard and trace pages to verify the recorded generator, safety gate, judge,
   latency, cost, and prompt-version provenance.

## Automated E2E and release gates

The browser suites launch isolated production builds and isolated Docker PostgreSQL projects. Use
non-default ports if the manual stack is still running:

```bash
SPOTTER_E2E_WEB_PORT=3300 pnpm test:e2e:web
SPOTTER_CLIENT_E2E_PORT=8181 SPOTTER_CLIENT_API_PORT=3201 pnpm test:e2e:client
pnpm test:a11y
pnpm test:mobile
```

Run the complete release-candidate matrix before promoting a commit:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm verify:full
```

`verify:full` includes generated-contract checks, coverage, PostgreSQL/pgvector integration and
concurrency, safety/property tests, browser E2E, accessibility, Docker lifecycle/security,
performance, mutation, and release-evidence integrity. It is intentionally much slower than the
focused commands.

## Logs, restart, and cleanup

```bash
docker compose logs --follow --tail=200 web postgres migrate seed
docker compose restart web
docker compose --profile demo down --remove-orphans
```

The normal `down` command preserves the synthetic PostgreSQL volume. To deliberately reset all local
Spotter data and reseed from scratch:

```bash
docker compose --profile demo down --volumes --remove-orphans
docker compose --profile demo up --build --detach --wait postgres migrate seed web
```

`down --volumes` permanently removes the local Spotter database volume; use it only when a reset is
intended.
