import { describe, expect, it } from 'vitest';
import { getStatus } from '../src/tools/get_status.js';
import { testConfig } from './helpers.js';

describe('get_status', () => {
  it('returns version, uptime, greeting and a summary', async () => {
    const config = testConfig();
    const startedAt = new Date(Date.now() - 42_000);
    const result = await getStatus.handler({}, { config, startedAt, azure: null });

    expect(getStatus.output.parse(result)).toEqual(result);
    expect(result.name).toBe('frank');
    expect(result.version).toBe(config.version);
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(42);
    expect(result.startedAt).toBe(startedAt.toISOString());
    expect(result.greeting).not.toBe('');
    expect(result.summary).toContain(config.version);
  });

  it('works with no Azure configuration at all', async () => {
    const config = testConfig();
    expect(config.azure).toBeNull();
    await expect(Promise.resolve(getStatus.handler({}, { config, startedAt: new Date(), azure: null }))).resolves.toHaveProperty('summary');
  });

  it('never reports negative uptime', async () => {
    const result = await getStatus.handler({}, { config: testConfig(), startedAt: new Date(Date.now() + 5000), azure: null });
    expect(result.uptimeSeconds).toBe(0);
  });
});
