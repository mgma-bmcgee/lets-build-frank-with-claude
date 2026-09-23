# Plan: implement ADR-001, ADR-002, ADR-003

## Context
`server/` and `ui/` are empty (only `.gitkeep`). The ADRs are the spec. We build
Frank's MCP server (ADR-001), its first tool under the tool rules (ADR-002), and
the Cloudscape console (ADR-003) — to the **net result** in CLAUDE.md, i.e. with
ADR-006 applied: one root `Dockerfile` (already exists, don't add one in
`server/`), console served by Frank at `/`, calls `/mcp` relatively, **no
`VITE_FRANK_URL`, no CORS, no auth**. No Azure tools yet — those are ADR-009.

Constraints from the existing root `Dockerfile` the code must satisfy:
- It copies `server/package.json` + `server/package-lock.json` unconditionally
  and runs `npm ci && npm test && npm run build` → output `dist/index.js`.
- Runtime: `server/dist` → `/app/dist`, `ui/dist` → `/app/public`; `CMD node dist/index.js`; `PORT=3000`.
- If `ui/package.json` exists it runs `npm ci && npm test && npm run build` — so
  `ui/` must have a real test script and lockfile before it is committed.

Two PRs, in order: **PR 1 = server (ADR-001 + 002)**, **PR 2 = console (ADR-003)**.
Never push directly to `main` (it deploys).

---

## Phase 0 — Pre-implementation gate (must pass before step 0)

Run `./docs/plans/preflight.sh`. It exits 0 only when every blocking check
passes, and it changes nothing in the repo: the spike installs into a temp
directory that is then deleted.

| Check | Blocking? | Why |
|---|---|---|
| Node ≥ 22, npm, `gh` authenticated | yes | ADR-001; PRs are opened with `gh` |
| Docker daemon running | yes | Step 9 builds the image. On `main`, the image build *is* the test gate |
| `server/` and `ui/` empty; no `server/Dockerfile` | yes | Nothing to clobber; ADR-006 says the root Dockerfile wins |
| GitHub Actions enabled on the fork | yes | Otherwise nothing builds or deploys |
| Pinned versions exist on npm; SDK accepts zod 4 | yes | The plan pins `sdk@1.30.1`, `express@5.2.1`, `zod@4.6.5` |
| **SDK spike** (`docs/plans/preflight-spike.mjs`), run on local Node **and Node 22** | yes | Proves the plan's load-bearing assumptions (below) with real code |
| Local HEAD = `origin/main`; not on `main`; `main` branch-protected | warn | CLAUDE.md: work on a branch, and protect `main` on the fork |

What the spike proves (12 checks):
- Stateless per-request server works end to end with the SDK client.
- `z.object({...}).strict()` reaches `tools/list` as `additionalProperties: false`.
- Parameter descriptions reach the JSON Schema.
- An extra field is rejected with `isError`, including on an empty schema, with a
  plain message and no stack trace: `Input validation error: … Unrecognized key: "sneaky"`.
- `hostHeaderValidation` on `/mcp` only: a foreign Host gets 403, `localhost:<port>`
  is allowed, `/healthz` stays open.
- `GET /mcp` → 405.

**Lesson carried into step 8:** Node's `fetch` (undici) silently ignores a
caller-set `Host` header, so a Host test written with `fetch` passes for the
wrong reason. The spike first reported a false 200 this way. Host-header tests
must use `supertest` (`.set('Host', …)`) or `node:http`.

**Last run (2026-09-23): GATE PASS.** The first run failed only because Docker
wasn't running; it passed once Rancher Desktop was started. The spike passed
12/12 on Node 26.8.2 and Node 22.23.2. Two warnings remain: on `main` (step 0
creates the branch) and `main` not branch-protected on the fork (owner's call).

Re-run until it prints `GATE: PASS`, then start step 0.

---

## PR 1 — `server/` (ADR-001, ADR-002)

**Step 0.** `git checkout -b feat/server-get-status`. (Untracked `CLAUDE.md` —
decide whether to commit it in this PR.)

**Step 1. Scaffold the package** — `server/package.json`:
- `"type": "module"`, `engines.node >= 22`.
- deps: `express` **5** (the SDK itself depends on `^5`; async handler rejections
  go to the error handler), `@modelcontextprotocol/sdk` **pinned exactly** (e.g.
  `1.30.1`, no `^` — schema/transport behaviour has changed between minors), `zod`.
- devDeps: `typescript`, `tsx`, `vitest`, `supertest`, `@types/express`, `@types/node`, `@types/supertest`.
- scripts: `dev` = `tsx watch src/index.ts`, `build` = `tsc -p tsconfig.json`, `test` = `vitest run`, `start` = `node dist/index.js`.
- `tsconfig.json`: `NodeNext`, `strict`, `rootDir: src`, `outDir: dist` (tests excluded from build).
- Run `npm install` to produce `package-lock.json` (must be committed).

**Step 2. `src/config.ts`** — zod-validated env, read once at boot:
- `PORT`: coerced int, default `3000`; invalid → exit with a plain message (“PORT must be a number between 1 and 65535, got 'abc'”), no stack.
- `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_CLIENT_ID/TENANT_ID/CLIENT_SECRET`: all **optional**; expose `azure: {...} | null` so future Azure tools fail closed. Never log the secret.
- `allowedHosts`: loopback names, plus `${CONTAINER_APP_NAME}.${CONTAINER_APP_ENV_DNS_SUFFIX}` when both are present (see step 6).
- `version` from `package.json`; `publicDir` = `<package root>/public` (resolved from `import.meta.url`, `../public` relative to `dist/`/`src/`).

**Step 3. `src/tools/define.ts`** — one helper every tool uses, enforcing ADR-002 mechanically:
- `defineTool({ name, description, input: z.object({...}).strict(), output, handler })`.
- Type-level + runtime guard: name must match `^(get|list|search|summarize)_[a-z0-9]+(_[a-z0-9]+)*$`.
- Wraps handler: success → `{ structuredContent, content: [{type:'text', text: JSON.stringify(result)}] }` where result always has `summary: string`; any throw → `{ isError: true, content: [{type:'text', text: <plain message>}] }`, no stack.
- Pass the **full `z.object({...}).strict()` instance** as `registerTool`'s
  `inputSchema`, never a raw shape. A raw shape gets wrapped in a plain
  `z.object()`, which silently drops unknown fields. A schema instance is passed
  through unchanged, so `.strict()` holds (Copilot checked this in SDK 1.30.1:
  `mcp.d.ts` `AnySchema`, `getZodSchemaObject`). This applies to empty schemas too:
  use `z.object({}).strict()`, not `{}`. There's no need for low-level handlers.
  Add a test showing that an extra field is rejected.

**Step 4. `src/tools/get_status.ts`** — ADR-002's first tool:
- Input: `z.object({}).strict()`.
- Output: `{ summary, name: "frank", version, uptimeSeconds, greeting, startedAt }`.
- Description (model-facing, 1–2 sentences): returns Frank's version, uptime and a greeting; use to check Frank is reachable. Must work with no Azure config.

**Step 5. `src/tools/index.ts`** — exports `tools` array and `registerTools(server)`.

**Step 6. `src/app.ts`** — `createApp(config)` returning Express app (no `listen`, so tests use it directly):
- `POST /mcp`: **stateless** Streamable HTTP — per request create `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`, register tools, `handleRequest(req, res, req.body)`, close on `res.close`. `express.json()` on this route.
- `GET /mcp`, `DELETE /mcp` → 405 JSON-RPC error (stateless, no SSE stream).
- `GET /healthz` → 200 `{ status: "ok" }`.
- `/` → `express.static(publicDir)`; if `public/index.html` is missing, `GET /` returns a short plain page: “Frank is running. MCP at /mcp. No console built yet.” SPA fallback to `index.html` for non-API GETs when it exists.
- No CORS middleware, no auth (ADR-006 / ADR-007 rejected).
- DNS-rebinding protection. **Chosen by vote: Option C, hybrid.** Mount the SDK's
  `hostHeaderValidation` middleware (`@modelcontextprotocol/sdk` `server/middleware/hostHeaderValidation.js`,
  which checks the hostname only and ignores the port) **on `/mcp` only**.
  `/healthz` and `/` stay unguarded, because a probe with no Host header would get a 403.
  - Always allow `localhost`, `127.0.0.1`, `[::1]`.
  - Also allow `${CONTAINER_APP_NAME}.${CONTAINER_APP_ENV_DNS_SUFFIX}` **only when both
    are set**. Container Apps injects them; derive this in `config.ts` as
    `allowedHosts`. It is never a required config value, because it is absent in
    tests, CI, Docker build and `npm run dev`.
  - Also allow `CONTAINER_APP_HOSTNAME` (this revision's own address, `<app>--<rev>.<suffix>`)
    when set. It was missed in review and found after the first deploy, where it got 403 (fix PR #2).
  - Do **not** use the transport's `enableDnsRebindingProtection`/`allowedHosts`: it
    compares the exact `host:port` string, so `localhost:3000` and `127.0.0.1:3000`
    would both have to be listed.
  - No Origin allowlist. The console is same-origin.
  - Comment the known limitation: reaching a local `docker run` Frank by LAN IP or
    another hostname loads the console, but tool calls return 403. This is expected.
  - Why: production `/mcp` is public anyway, but local dev may run with the
    developer's own `az login` identity through `DefaultAzureCredential`. The cost
    is near zero. The SDK's own `createMcpExpressApp` defaults to this for loopback.
- Error handler returns plain JSON, never a stack.

**Step 7. `src/index.ts`** — load config (friendly exit on error), `createApp`, `listen(PORT)`, log one line, handle SIGTERM gracefully.

**Step 8. Tests (`server/test/`, vitest)**:
- `config.test.ts`: default port, bad port message, missing Azure vars → `azure === null` (no throw).
- `get_status.test.ts`: shape, `summary` present, uptime ≥ 0, works without Azure env.
- `conventions.test.ts`: checks every registered tool for the name pattern and closed verb set, a non-empty description of at most 2 sentences, `.describe()` on every input property, and a `summary` in the handler output. It also **calls each tool through the real MCP server with an extra unknown field and expects `isError`**, so a tool added later can't lose strictness unnoticed.
- Host-header cases use `supertest` `.set('Host', …)`, **never `fetch`**, which silently drops a caller-set Host (see Phase 0).
- `app.test.ts` (supertest + SDK `Client` over `StreamableHTTPClientTransport` against an ephemeral `listen(0)`): `/healthz` 200; `/` 200 with empty `public/`; `tools/list` contains `get_status`; `tools/call get_status` returns structured content; extra arg → error; `GET /mcp` → 405; `/mcp` with `Host: evil.example` → 403; `/mcp` with `Host: localhost:3000` and `127.0.0.1:<port>` → allowed; `/healthz` with a foreign Host → 200; when the ACA env vars are set, the derived FQDN is allowed.

**Step 9. Verify locally**: `cd server && npm test && npm run build && npm run dev`; `curl localhost:3000/healthz`; then `docker build -t frank . && docker run -p 3000:3000 frank` (proves Dockerfile path incl. empty `ui/`).

**Step 10. Gatekeeping**: run the `tool-conventions` agent, then `secret-scanner` agent; fix findings. Commit, push branch, open PR → CI `build-server` runs. Merge → deploy.

**Step 11. Prove client wiring**: `claude mcp add --transport http frank https://<fqdn>/mcp`, restart `claude`, call `get_status`.

---

## PR 2 — `ui/` console (ADR-003, wired per ADR-006)

**Step 12.** `git checkout -b feat/console` from updated `main`.

**Step 13. Scaffold** `ui/` (Vite React-TS): React 18, `@cloudscape-design/components`, `@cloudscape-design/global-styles`, `@modelcontextprotocol/sdk` (browser client). Dev: `vitest`, `jsdom`, `@testing-library/react`. Scripts `dev`, `build` (`tsc -b && vite build` → `ui/dist`), `test` (`vitest run`). Commit lockfile **together with** `package.json` (Docker stage requires both).

**Step 14. MCP client (`src/mcp.ts`)**: `Client` + `StreamableHTTPClientTransport(new URL('/mcp', window.location.origin))` — relative, no env var. Helpers `listTools()`, `callTool(name, args)`. `vite.config.ts` dev-server **proxy** `/mcp` → `http://localhost:3000` (dev-only; keeps the relative URL, no CORS). The SDK client bundles cleanly in Vite with no polyfills (Copilot built a test app to check). It costs about 84 KB gzipped, which is fine. Server-side `GET /mcp` → 405 is handled by the client as expected.

**Step 15. Shell (`src/App.tsx`)**: Cloudscape `AppLayout` + `SideNavigation` (Overview, Tools) + `Flashbar` for errors; hash-based routing (no router lib needed). `import '@cloudscape-design/global-styles/index.css'`. No custom CSS beyond layout glue, no other component library, no secrets.

**Step 16. Overview page**: calls `get_status`; `Container` + `KeyValuePairs` (version, uptime, greeting) + `StatusIndicator` for connection health; refresh button.

**Step 17. Tools page**: `Table` of tools from `tools/list` (name, description). Selecting one renders a form from its JSON `inputSchema` via a pure `schemaToFields()` mapper: string → `Input`, number/integer → numeric `Input`, boolean → `Checkbox`, enum → `Select`, `required` honoured, parameter description as `FormField` description. Submit → `callTool`; show result as formatted JSON (`CodeView` or `Box` `<pre>`), `isError` → `Alert`. A tool with no params shows just “Invoke”.

**Step 18. Tests**: `schemaToFields` unit tests (each type, required, enum, empty schema); a render test of Tools page with a mocked `mcp.ts`.

**Step 19. Verify**: `cd server && npm run dev` + `cd ui && npm run dev` → Overview shows status, Tools lists `get_status` and invokes it. Then `docker build` + `docker run -p 3000:3000 frank` → console at `http://localhost:3000/`, calling `/mcp` same-origin.

**Step 20.** `secret-scanner` agent → PR → CI `build-ui` → merge → deploy → open `https://<fqdn>/`.

---

## Not doing (superseded/rejected — per CLAUDE.md)
`VITE_FRANK_URL`, CORS, Static Web Apps, bearer token / `FRANK_MCP_TOKEN`, a
`server/Dockerfile`, managed identity, any Azure tool (ADR-009 comes later).
