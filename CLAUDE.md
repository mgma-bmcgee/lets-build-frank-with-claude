# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Frank is an MCP server plus a Cloudscape web console, shipped as **one container**
to Azure Container Apps by `.github/workflows/deploy.yml`. `server/` and `ui/`
start empty; they are built from the ADRs in `docs/adr/`.

**The ADRs are the spec.** Before writing code, read the ADR you are
implementing and anything that supersedes it. If an instruction here conflicts
with an ADR, stop and ask — do not pick one silently.

## What is actually in force

Several ADRs are partly superseded. Build to this net result, not to any single
early ADR:

| Topic | In force | Source |
|---|---|---|
| Stack | TypeScript, Node 22+, Express, `@modelcontextprotocol/sdk`, zod | ADR-001 |
| Endpoints | `POST /mcp` (Streamable HTTP), `GET /healthz`, console at `/` | ADR-001, ADR-006 |
| Tools | `verb_noun`; verbs only `get`/`list`/`search`/`summarize`; read-only | ADR-002 |
| Console | React 18 + Vite + Cloudscape only; Overview + Tools pages; schema-driven forms; holds no secrets | ADR-003 |
| Console wiring | Served by Frank at `/`, calls `/mcp` **relatively**. No `VITE_FRANK_URL`, no CORS | ADR-006 |
| Container | One root-level multi-stage `Dockerfile`; port **3000** | ADR-006 |
| Hosting | Container Apps, min 0 / max 1 replicas, external ingress | ADR-004 |
| Credential | One public classroom credential fetched by the pipeline; students set nothing | ADR-010 |
| Resource group | Shared `rg-frank-class`; app name `frank-<github-owner>` | ADR-010 |
| Azure auth at runtime | `DefaultAzureCredential` from env vars (below). **No managed identity** | ADR-010 |
| MCP auth | **None.** `/mcp` is deliberately unauthenticated | ADR-007 (Rejected) |

### Do NOT build these (superseded or rejected)

- Static Web Apps, `VITE_FRANK_URL`, CORS config (ADR-003/004 → ADR-006)
- GitHub OIDC, `id-token: write`, `environment: production`, per-student
  secrets or repo variables, `setup-seat.sh` (ADR-005/006 → ADR-010)
- A managed identity or a `Reader` role assignment (ADR-004/006 → ADR-010)
- Bearer-token auth, `FRANK_MCP_TOKEN`, `mcp-remote`, token modal (ADR-007 is
  **Rejected** — its file references describe code that does not exist)

## Runtime environment

All config comes from environment variables (ADR-001). The pipeline sets:

| Var | Notes |
|---|---|
| `PORT` | Default `3000`. Must match the Dockerfile and `--target-port` |
| `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP` | Frank's scope, read at boot |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET` | Picked up by `DefaultAzureCredential` |

Validate config with zod at boot and fail with a plain-language message. Missing
Azure vars must make Azure tools **fail closed** with `isError: true` — they
must not crash the server, because `get_status` has to work without Azure.

## Layout conventions

```
server/                 self-contained npm package
  src/index.ts          entry; built to dist/index.js
  src/app.ts            Express app: /mcp, /healthz, static console from <pkg root>/public
  src/config.ts         zod-validated env config
  src/tools/            one module per tool, plus define.ts and index.ts
  test/                 vitest
ui/                     self-contained npm package (Vite), build output ui/dist
```

Both packages need `npm run dev`, `npm test`, `npm run build`, and a committed
`package-lock.json` (CI only builds a package once its lockfile exists).

## Tool rules (ADR-002) — non-negotiable

- Name `verb_noun`, lower snake_case, verb in `get|list|search|summarize`.
  `create_`, `update_`, `delete_`, `run_` are policy violations.
- One- or two-sentence description written for a model; every parameter described.
- zod input schema, unknown fields rejected (`.strict()`).
- Output: structured JSON with a top-level `summary` string plus typed fields.
- Errors: `isError: true`, plain-language message, never a stack trace.
- **Never mutate anything external** — Azure, GitHub, filesystem beyond temp.
  Use read-only Azure SDK calls only. The credential Frank holds is
  *Contributor*; the tool surface is the only thing keeping him read-only.
- **No tool parameter may change scope** (no `resource_group`, `subscription`).
  Scope comes from the environment only.
- First tool is `get_status` (version, uptime, greeting). Prove the pipeline and
  client wiring with it before any Azure code.

The `frank-tools` skill has the details. After adding or changing tools, run
the `tool-conventions` agent.

## Build order

1. `server/` with `get_status`, `/healthz`, tests, lockfile → push → deploy works.
2. Connect a client: `claude mcp add --transport http frank https://<fqdn>/mcp`,
   then restart `claude`.
3. ADR-009 (Frank reads his resource group) — draft, review, implement.
4. `ui/` console (optional to deploy; the Dockerfile tolerates an empty `ui/`).

**Gotcha:** the Dockerfile copies `server/package.json` and
`server/package-lock.json` unconditionally, so a push to `main` fails until
`server/` is scaffolded. Don't push to `main` before step 1 is done.

## ADR workflow (ADR-000)

- New ADR: `/adr <title>` — copies `docs/adr/template.md`, takes the next
  number, Status **Proposed**, one page, Context → Decision → Consequences.
- Always run the **`adr-reviewer`** agent on a drafted or changed ADR, then have
  Copilot attack it. A human accepts it via PR.
- Accepted ADRs are immutable. Change course with a new superseding ADR; only
  the superseded ADR's Status line may be edited.
- Reference ADRs by number in implementation prompts ("implement ADR-009").

### ADR-009 must address

- Auth via `DefaultAzureCredential` and the env vars above — not a managed identity.
- `rg-frank-class` is **shared**: listing it shows every classmate's app. Decide
  whether Frank shows everything or filters to his own app, and say so.
- `/mcp` is public (ADR-007 rejected), so anyone with the URL sees that
  inventory. State this in Consequences.
- Tools stay read-only, scope from env only, fail closed when Azure vars are missing.

## Known doc inconsistencies (don't "fix" by guessing)

- Root `README.md` lists ADR-006 and ADR-010 as *Proposed*; the ADR files and
  `docs/adr/README.md` say **Accepted**. Treat them as Accepted.
- ADR-008 is "written in class" in the root README but an *optional stretch* in
  `docs/adr/README.md`. Treat it as optional.
- ADR-001 puts the Dockerfile in `server/`; ADR-006 moved it to the root. Root wins.
- The Dockerfile comment "ADR-004 gives Frank a managed identity" is stale (ADR-010).
- The root README's layout lists an `instructor/` directory. It is not in this repo.
- ADR-007 cites files such as `server/vitest.config.ts`. They do not exist; they
  describe the rejected design.

## How CI gates work (spread across deploy.yml and the Dockerfile)

- **PRs:** `build-server` and `build-ui` run `npm ci && npm test && npm run build`,
  but only for a package whose `package-lock.json` is committed. Without a
  lockfile the job passes with a notice and does nothing.
- **Push to `main`:** those jobs are skipped. The Dockerfile's build stages run
  `npm test`, so **a failing test fails the image build and nothing deploys**.
- The `ui-build` stage runs `npm ci && npm test && npm run build` as soon as
  `ui/package.json` exists. Give `ui/` a working `test` script and lockfile before
  you commit its `package.json`, or deploys break.
- Runtime layout in the image: `server/dist` → `/app/dist`, `ui/dist` →
  `/app/public`. `app.ts` must serve the console from `<pkg root>/public` and
  still answer at `/` when that directory is empty.

## Security

- Never put credentials in code, tests, fixtures, ADRs, prompts, or this file.
  `.env*` is gitignored. Do not print the fetched classroom credential.
- Run the **`secret-scanner`** agent before committing or opening a PR.
- `main` deploys. Work on a branch and merge by PR; enable branch protection
  on the fork (it is not inherited from upstream).
- Keep Claude Code permission prompts on for destructive actions.

## Commands

```bash
cd server && npm run dev        # local Frank on :3000
cd server && npm test           # vitest
cd server && npx vitest run test/<file>.test.ts -t "<test name>"   # one test
cd ui && npm run dev            # console dev server
docker build -t frank . && docker run -p 3000:3000 frank   # full image locally
```
