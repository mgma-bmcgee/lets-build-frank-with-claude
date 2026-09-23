import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, loadConfig } from '../src/config.js';

/** A config with no Azure variables and an empty console directory. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const emptyPublic = mkdtempSync(join(tmpdir(), 'frank-public-'));
  return { ...loadConfig({}), publicDir: emptyPublic, ...overrides };
}
