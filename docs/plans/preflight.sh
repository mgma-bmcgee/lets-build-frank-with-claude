#!/usr/bin/env bash
# Pre-implementation gate for docs/plans/implement-adr-001-002-003.md.
# Read-only against the repo: the spike installs into a temp dir and is deleted.
# Exit 0 = every BLOCKING check passed. WARN lines are fixable but don't block.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SDK=1.30.1 EXPRESS=5.2.1 ZOD=4.6.5
fail=0
pass() { echo "PASS  $*"; }
warn() { echo "WARN  $*"; }
block() { echo "FAIL  $*"; fail=1; }

echo "== toolchain"
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$node_major" -ge 22 ] && pass "node $(node -v) (>= 22, ADR-001)" || block "node >= 22 required (ADR-001), found $(node -v 2>/dev/null || echo none)"
command -v npm >/dev/null && pass "npm $(npm -v)" || block "npm missing"
docker info >/dev/null 2>&1 && pass "docker daemon running" || block "docker daemon not reachable - start Docker/Rancher Desktop (needed for step 9: the image build is the main-branch test gate)"
gh auth status >/dev/null 2>&1 && pass "gh authenticated" || block "gh not authenticated - run: gh auth login"

echo "== repo state"
cd "$REPO"
[ -z "$(ls -A server | grep -v '^.gitkeep$')" ] && pass "server/ is empty (nothing to clobber)" || block "server/ already has content - review before scaffolding"
[ -z "$(ls -A ui | grep -v '^.gitkeep$')" ] && pass "ui/ is empty" || warn "ui/ already has content"
[ ! -e server/Dockerfile ] && pass "no server/Dockerfile (ADR-006: root wins)" || block "server/Dockerfile exists - ADR-006 says root Dockerfile only"
git fetch -q origin 2>/dev/null
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main 2>/dev/null)" ] && pass "local HEAD matches origin/main" || warn "local HEAD differs from origin/main - branch from an up-to-date main"
branch=$(git branch --show-current)
[ "$branch" != "main" ] && pass "on branch '$branch' (not main)" || warn "on main - create a branch before the first commit (main deploys)"
slug=$(git remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')
gh api "repos/$slug/branches/main/protection" >/dev/null 2>&1 && pass "branch protection on main ($slug)" || warn "main is NOT protected on $slug - enable it (CLAUDE.md: not inherited from upstream)"
[ "$(gh api "repos/$slug/actions/permissions" -q .enabled 2>/dev/null)" = "true" ] && pass "GitHub Actions enabled on $slug" || block "GitHub Actions disabled on $slug - enable it or nothing deploys"

echo "== pinned packages resolvable"
for p in "@modelcontextprotocol/sdk@$SDK" "express@$EXPRESS" "zod@$ZOD" "react@18" "@cloudscape-design/components" "@cloudscape-design/global-styles"; do
  npm view "$p" version >/dev/null 2>&1 && pass "$p on npm" || block "$p not resolvable on npm"
done
peer=$(npm view "@modelcontextprotocol/sdk@$SDK" peerDependencies.zod 2>/dev/null)
case "$peer" in *"^4"*) pass "sdk@$SDK accepts zod 4 (peer: $peer)";; *) block "sdk@$SDK zod peer is '$peer' - zod@$ZOD may not fit";; esac

echo "== SDK behaviour spike (Node $(node -v))"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "$REPO/docs/plans/preflight-spike.mjs" "$tmp/spike.mjs"
( cd "$tmp" && npm init -y >/dev/null && npm pkg set type=module >/dev/null \
  && npm install --silent --save-exact "@modelcontextprotocol/sdk@$SDK" "express@$EXPRESS" "zod@$ZOD" >/dev/null 2>&1 ) \
  || block "could not install spike dependencies"
if [ "$fail" -eq 0 ] || [ -d "$tmp/node_modules" ]; then
  (cd "$tmp" && node spike.mjs) || block "spike failed on $(node -v)"
  if [ "$node_major" -ne 22 ]; then
    echo "-- re-running spike on Node 22 (the Docker image's runtime)"
    (cd "$tmp" && npx -y node@22 spike.mjs | tail -1) || block "spike failed on Node 22"
  fi
fi

echo
[ "$fail" -eq 0 ] && echo "GATE: PASS - clear to start implementation" || echo "GATE: FAIL - fix the FAIL lines above before implementing"
exit "$fail"
