import { describe, expect, it } from 'vitest';
import type { ContainerAppSummary } from '../src/azure.js';
import { listContainerApps } from '../src/tools/list_container_apps.js';
import { fakeGateway, mcpClientWith, testConfig } from './helpers.js';

const app = (name: string, runningStatus: string | null): ContainerAppSummary => ({
  name,
  fqdn: `${name}.example.eastus2.azurecontainerapps.io`,
  provisioningState: 'Succeeded',
  runningStatus,
  latestRevision: `${name}--0000002`,
  latestReadyRevision: `${name}--0000002`,
  minReplicas: 0,
  maxReplicas: 1,
});
const APPS = [app('frank-mgma-bmcgee', 'Running'), app('frank-octocat', 'Running'), app('frank-hubot', 'Stopped')];

function run(opts: { self?: string | null; truncated?: boolean } = {}) {
  const azure = fakeGateway({ listContainerApps: async () => ({ items: APPS, truncated: opts.truncated ?? false }) });
  const config = testConfig({ selfAppName: opts.self === undefined ? 'frank-mgma-bmcgee' : opts.self });
  return listContainerApps.handler({}, { config, startedAt: new Date(), azure });
}

describe('list_container_apps', () => {
  it("lists every classmate's app and reports Frank's own", async () => {
    const result = await run();
    expect(listContainerApps.output.parse(result)).toEqual(result);
    expect(result.count).toBe(3);
    expect(result.apps.filter((a) => a.isSelf).map((a) => a.name)).toEqual(['frank-mgma-bmcgee']);
    expect(result.summary).toBe("3 container apps in rg-frank-class, 2 running; Frank's own app is running.");
  });

  it('leaves out the self clause outside Container Apps', async () => {
    const result = await run({ self: null });
    expect(result.apps.some((a) => a.isSelf)).toBe(false);
    expect(result.summary).toBe('3 container apps in rg-frank-class, 2 running.');
  });

  it('says so when the list was cut short', async () => {
    expect((await run({ truncated: true })).summary).toContain('cut short');
  });

  it('fails closed without Azure', async () => {
    await expect(listContainerApps.handler({}, { config: testConfig(), startedAt: new Date(), azure: null })).rejects.toThrow(
      /Azure is not configured/,
    );
  });

  it('returns schema-valid output through the real MCP server', async () => {
    const client = await mcpClientWith(fakeGateway({ listContainerApps: async () => ({ items: APPS, truncated: false }) }));
    const result = await client.callTool({ name: 'list_container_apps', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ count: 3 });
    await client.close();
  });
});
