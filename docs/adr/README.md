# Architecture Decision Records

The decisions Frank is built from. Read them before writing code — and point
your agents at them by number (*"implement ADR-003"*).

| ADR | Decision | Status |
|---|---|---|
| [ADR-000](ADR-000-record-architecture-decisions.md) | Record architecture decisions as ADRs | Accepted |
| [ADR-001](ADR-001-mcp-server-stack.md) | Frank's stack: TypeScript + official MCP SDK, Streamable HTTP | Accepted |
| [ADR-002](ADR-002-mcp-tool-conventions.md) | Tool naming, schemas, and the read-only rule | Accepted |
| [ADR-003](ADR-003-cloudscape-ui.md) | The console: React + Vite + Cloudscape | Accepted — partly superseded by 006 |
| [ADR-004](ADR-004-azure-hosting.md) | Hosting: Container Apps (Frank) + Static Web Apps (UI) | Accepted — partly superseded by 006, 010 |
| [ADR-005](ADR-005-github-actions-deployment.md) | Deployment: GitHub Actions with OIDC to Azure | Accepted — partly superseded by 006 |
| [ADR-006](ADR-006-classroom-credentials.md) | Classroom credentials + one container (partly supersedes 003, 004, 005) | Accepted |
| [ADR-007](ADR-007-mcp-endpoint-authentication.md) | MCP endpoint requires caller authentication | **Rejected** — see the ADR for what that accepts |
| [ADR-010](ADR-010-one-open-credential.md) | One deliberately open classroom credential (supersedes 006's credential model) | Accepted |
| ADR-008 | Connect Frank to the GitHub pipeline so he can report on builds | *optional stretch — not scheduled* |
| [ADR-009](ADR-009-read-the-resource-group.md) | Frank reads what is running in his resource group | Proposed |

New ADR? Copy [`template.md`](template.md), take the next number, and follow the
workflow in ADR-000: **Claude drafts → Copilot attacks → a human decides.**
