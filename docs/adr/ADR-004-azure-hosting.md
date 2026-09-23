# ADR-004: Hosting — Container Apps for Frank, Static Web Apps for the UI

**Status:** Accepted — **partially superseded by ADR-006** (Static Web Apps hosting and
cross-origin UI wiring) **and ADR-010** (the managed identity, and one resource
group per student); the scale-to-zero, `/healthz` probe and single-region
decisions remain in force
**Date:** 2026-08

## Context

Frank (a long-running HTTP service) and the console (static files) need homes in
Azure. Constraints: one resource group per student, near-zero idle cost on
personal subscriptions, HTTPS out of the box, no cluster administration during a
one-day class, and a deployment story simple enough for GitHub Actions (ADR-005).

## Decision

Everything for one student lives in **one resource group**: `rg-frank-<alias>`,
in a single region chosen at class time.

- **Frank →  Azure Container Apps.** The `server/` Dockerfile is built and
  deployed as a Container App with external HTTPS ingress on Frank's port,
  min replicas 0 (scale-to-zero), max 1. Health probe: `GET /healthz`.
  Runtime settings arrive as environment variables / Container Apps secrets.
- **Console → Azure Static Web Apps** (Free tier). The `ui/` Vite build output
  is deployed as a static site; `VITE_FRANK_URL` is injected at build time in
  the pipeline.
- **Identity:** the Container App gets a **system-assigned managed identity** at
  creation. It starts with **no role assignments** — ADR-009 (written in class)
  decides exactly what read access it receives and at what scope.

## Consequences

- Scale-to-zero + SWA Free keeps a student's idle cost at pennies; nothing to
  patch, no cluster to manage.
- The managed identity means Frank will read Azure **without any stored
  credential** — the class sees least-privilege done the native way, and
  granting access later is one role assignment, not a secret rotation.
- Cold starts of a few seconds after idle are acceptable for a classroom tool.
- Rejected: AKS (cluster ops in a one-day class), a single VM (patching, no
  scale-to-zero, worst security story), Azure Functions (long-lived MCP
  connections fit a container better).
