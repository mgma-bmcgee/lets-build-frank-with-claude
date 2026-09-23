# ADR-009: Frank reads what is running in his resource group

**Status:** Proposed — builds on ADR-010's runtime credential
**Date:** 2026-09

## Context

Frank can only describe himself (`get_status`); the class builds toward him
answering "what is running?".

Three facts make this harder than calling the Azure SDK. The classroom
credential (ADR-010) is **Contributor**, so only the tool surface keeps Frank
read-only (ADR-002). The group, `rg-frank-class`, is **shared**: every
classmate's app, the registry and the environment. And `/mcp` is **public**
(ADR-007 rejected), so whatever Frank sees, anyone with his URL sees.

## Decision

- **Three tools** on the existing `POST /mcp`, no new endpoints:
  - `list_resources`: every resource's name, type, location and
    `provisioningState`, with an optional `type` filter (full ARM type,
    case-insensitive).
  - `list_container_apps`: each app's FQDN, running status, latest revision and
    scale limits.
  - `get_container_app` (`name`): image, ingress, scale, revisions, and
    environment variable **names only**.
- **Show the whole group**, marking Frank's own app as `isSelf` (matched on
  `CONTAINER_APP_NAME`, which Container Apps injects; if absent, nothing is).
  Scope comes from `AZURE_SUBSCRIPTION_ID` and `AZURE_RESOURCE_GROUP`; no
  parameter widens it.
- **One read-only gateway.** Only `server/src/azure.ts` imports `@azure/*`,
  exposing exactly these reads. Secret-returning operations stay out even when
  named `list` (`listSecrets`).
- **Fail closed.** Check the five variables `deploy.yml` sets (ADR-010) before
  building `DefaultAzureCredential`; if any is missing, return `isError` naming
  it, so Frank never reaches a developer's `az login`. Azure failures return a
  plain message, not the raw error. Lists are capped by a code constant, and
  `summary` says so. Tests use a fake gateway.

## Consequences

- No new credential, identity or pipeline change.
- **Anyone with Frank's URL sees the class inventory**: app names (GitHub
  usernames), FQDNs, images, variable names. No secrets and no write path.
  Acceptable for one afternoon; the names are already public in the forks and
  their public Actions logs.
- Read-only rests on review of one small file, not on the credential.
- Azure tools can't run locally, since students never hold the credential; real
  verification waits for a deploy.
- Every call is an ARM round trip, throttled across the class.
- Rejected: filtering to Frank's own app (implies isolation the shared
  credential lacks); REST endpoints (ADR-001 fixes the surface); Resource Graph
  (a query language for one group); a Reader-only credential (right at work,
  but it restores the provisioning ADR-010 removed).
