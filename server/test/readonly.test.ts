// The read-only guarantee, checked in source (ADR-009). The credential Frank
// holds can write, so these checks are what stop a write from sneaking in.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
  );
}

// Operation names on the SDK clients that write, or that return secrets.
const FORBIDDEN =
  /\b(listSecrets|getAuthToken|begin[A-Z]\w*|createOrUpdate\w*|delete\w*|update\w*|start|stop|restart\w*|activate\w*|deactivate\w*|moveResources|validateMoveResources|exportTemplate)\s*\(/;

describe('read-only Azure access', () => {
  it('only src/azure.ts imports the Azure SDK', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.endsWith(join('src', 'azure.ts')))
      .filter((file) => /from\s+['"]@azure\//.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('src/azure.ts calls no write or secret-returning operation', () => {
    const code = readFileSync(join(SRC, 'azure.ts'), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code.match(FORBIDDEN)?.[0] ?? null).toBeNull();
  });

  it('src/azure.ts uses exactly the three read operations ADR-009 allows', () => {
    const code = readFileSync(join(SRC, 'azure.ts'), 'utf8');
    const calls = [...code.matchAll(/\.(resources|containerApps|containerAppsRevisions)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(new Set(calls)).toEqual(
      new Set([
        'resources.listByResourceGroup',
        'containerApps.listByResourceGroup',
        'containerApps.get',
        'containerAppsRevisions.listRevisions',
      ]),
    );
  });
});
