import { describe, expect, it } from 'vitest';
import type { ResourceSummary } from '../src/azure.js';
import { ToolError } from '../src/tools/define.js';
import { listResources } from '../src/tools/list_resources.js';
import { fakeGateway, mcpClientWith, testConfig } from './helpers.js';

const RESOURCES: ResourceSummary[] = [
  { name: 'frank-mgma-bmcgee', type: 'Microsoft.App/containerApps', location: 'eastus2', provisioningState: 'Succeeded' },
  { name: 'frank-octocat', type: 'Microsoft.App/containerApps', location: 'eastus2', provisioningState: 'Succeeded' },
  { name: 'acrfrankclass', type: 'Microsoft.ContainerRegistry/registries', location: 'eastus2', provisioningState: 'Succeeded' },
  { name: 'cae-frank-class', type: 'Microsoft.App/managedEnvironments', location: 'eastus2', provisioningState: null },
];

function run(args: { type?: string }, opts: { self?: string | null; truncated?: boolean; fail?: Error } = {}) {
  const azure = fakeGateway({
    listResources: async () => {
      if (opts.fail) throw opts.fail;
      return { items: RESOURCES, truncated: opts.truncated ?? false };
    },
  });
  const config = testConfig({ selfAppName: opts.self === undefined ? 'frank-mgma-bmcgee' : opts.self });
  return listResources.handler(args, { config, startedAt: new Date(), azure });
}

describe('list_resources', () => {
  it('lists the whole shared group and marks Frank himself', async () => {
    const result = await run({});
    expect(listResources.output.parse(result)).toEqual(result);
    expect(result.count).toBe(4);
    expect(result.resources.filter((r) => r.isSelf).map((r) => r.name)).toEqual(['frank-mgma-bmcgee']);
    expect(result.summary).toBe('4 resources of 3 types in rg-frank-class.');
    expect(result.resourceGroup).toBe('rg-frank-class');
  });

  it('filters by full ARM type, case-insensitively', async () => {
    const result = await run({ type: 'microsoft.app/CONTAINERAPPS' });
    expect(result.resources.map((r) => r.name)).toEqual(['frank-mgma-bmcgee', 'frank-octocat']);
    expect(result.summary).toBe('2 microsoft.app/CONTAINERAPPS resources in rg-frank-class.');
  });

  it('does not treat a partial type as a match', async () => {
    const result = await run({ type: 'Microsoft.App' });
    expect(result.count).toBe(0);
  });

  it('marks nothing as self outside Container Apps', async () => {
    const result = await run({}, { self: null });
    expect(result.resources.some((r) => r.isSelf)).toBe(false);
  });

  it('says so when the list was cut short', async () => {
    const result = await run({}, { truncated: true });
    expect(result.truncated).toBe(true);
    expect(result.summary).toContain('cut short');
  });

  it('fails closed, naming what is missing, when Azure is not configured', async () => {
    const config = testConfig();
    const attempt = listResources.handler({}, { config, startedAt: new Date(), azure: null });
    await expect(attempt).rejects.toBeInstanceOf(ToolError);
    await expect(listResources.handler({}, { config, startedAt: new Date(), azure: null })).rejects.toThrow(
      /Azure is not configured.*AZURE_SUBSCRIPTION_ID/,
    );
  });

  it("passes the gateway's plain-language failure through", async () => {
    await expect(run({}, { fail: new ToolError('Azure is throttling requests right now (429). Try again in a minute.') })).rejects.toThrow(
      'throttling',
    );
  });

  it('rejects a scope-changing argument', () => {
    expect(listResources.input.safeParse({ resource_group: 'someone-elses' }).success).toBe(false);
  });
});

describe('list_resources over MCP', () => {
  it('returns output that passes the declared schema through the real server', async () => {
    const client = await mcpClientWith(fakeGateway({ listResources: async () => ({ items: RESOURCES, truncated: false }) }));
    const result = await client.callTool({ name: 'list_resources', arguments: { type: 'Microsoft.App/containerApps' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ count: 2, resourceGroup: 'rg-frank-class' });
    await client.close();
  });

  it('returns a plain isError when Azure is not configured', async () => {
    const client = await mcpClientWith(null);
    const result = await client.callTool({ name: 'list_resources', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(/^Azure is not configured/);
    await client.close();
  });
});
