import { describe, expect, it, vi } from 'vitest';
import type { ContainerAppDetail } from '../src/azure.js';
import { getContainerApp } from '../src/tools/get_container_app.js';
import { fakeGateway, mcpClientWith, testConfig } from './helpers.js';

const DETAIL: ContainerAppDetail = {
  name: 'frank-octocat',
  fqdn: 'frank-octocat.example.eastus2.azurecontainerapps.io',
  provisioningState: 'Succeeded',
  runningStatus: 'Running',
  latestRevision: 'frank-octocat--0000002',
  latestReadyRevision: 'frank-octocat--0000002',
  minReplicas: 0,
  maxReplicas: 1,
  ingress: { external: true, targetPort: 3000 },
  containers: [{ name: 'frank-octocat', image: 'acr.azurecr.io/frank-octocat:abc123', envVarNames: ['AZURE_CLIENT_SECRET', 'PORT'] }],
  revisions: [
    { name: 'frank-octocat--0000002', active: true, replicas: 1, trafficWeight: 100, healthState: 'Healthy', runningState: 'Running', createdTime: '2026-09-23T21:33:00.000Z' },
    { name: 'frank-octocat--0000001', active: false, replicas: 0, trafficWeight: 0, healthState: 'None', runningState: 'Stopped', createdTime: '2026-09-23T20:00:00.000Z' },
  ],
};

function run(name: string, opts: { self?: string | null; found?: ContainerAppDetail | null } = {}) {
  const lookup = vi.fn(async () => (opts.found === undefined ? DETAIL : opts.found));
  const azure = fakeGateway({ getContainerApp: lookup });
  const config = testConfig({ selfAppName: opts.self === undefined ? 'frank-mgma-bmcgee' : opts.self });
  return { lookup, result: getContainerApp.handler({ name }, { config, startedAt: new Date(), azure }) };
}

describe('get_container_app', () => {
  it("describes a classmate's app", async () => {
    const { result, lookup } = run('frank-octocat');
    const out = await result;
    expect(getContainerApp.output.parse(out)).toEqual(out);
    expect(lookup).toHaveBeenCalledWith('frank-octocat');
    expect(out.summary).toBe('frank-octocat is running on frank-octocat--0000002, healthy, 1 replica.');
    expect(out.isSelf).toBe(false);
    expect(out.scale).toEqual({ minReplicas: 0, maxReplicas: 1 });
    expect(out.containers[0]?.envVarNames).toEqual(['AZURE_CLIENT_SECRET', 'PORT']);
    expect(out.revisions).toHaveLength(2);
  });

  it('marks Frank himself', async () => {
    const out = await run('frank-octocat', { self: 'frank-octocat' }).result;
    expect(out.isSelf).toBe(true);
    expect(out.summary).toContain("(Frank's own app)");
  });

  it('says plainly when there is no such app in the group', async () => {
    await expect(run('frank-nobody', { found: null }).result).rejects.toThrow("No container app named 'frank-nobody' in rg-frank-class.");
  });

  it.each([
    'Frank-Octocat',
    '../subscriptions/other',
    'frank/octocat',
    'a',
    'frank--octocat',
    '-frank',
    'frank-',
    'x'.repeat(33),
    'rg-other/providers/Microsoft.App/containerApps/x',
  ])('rejects %j before it reaches Azure', (name) => {
    expect(getContainerApp.input.safeParse({ name }).success).toBe(false);
  });

  it('accepts real app names', () => {
    for (const name of ['frank-mgma-bmcgee', 'frank-octocat', 'ab', 'x'.repeat(32)]) {
      expect(getContainerApp.input.safeParse({ name }).success, name).toBe(true);
    }
  });

  it('cannot be pointed at another resource group or subscription', () => {
    expect(getContainerApp.input.safeParse({ name: 'frank-octocat', resource_group: 'rg-other' }).success).toBe(false);
    expect(getContainerApp.input.safeParse({ name: 'frank-octocat', subscription: 'other' }).success).toBe(false);
  });

  it('fails closed without Azure', async () => {
    await expect(getContainerApp.handler({ name: 'frank-octocat' }, { config: testConfig(), startedAt: new Date(), azure: null })).rejects.toThrow(
      /Azure is not configured/,
    );
  });

  it('returns schema-valid output, and a plain error for a bad name, through the real MCP server', async () => {
    const client = await mcpClientWith(fakeGateway({ getContainerApp: async () => DETAIL }));
    const ok = await client.callTool({ name: 'get_container_app', arguments: { name: 'frank-octocat' } });
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent).toMatchObject({ name: 'frank-octocat', isSelf: false });
    const bad = await client.callTool({ name: 'get_container_app', arguments: { name: '../../etc' } });
    expect(bad.isError).toBe(true);
    expect((bad.content as Array<{ text: string }>)[0]?.text).toMatch(/Container Apps name/);
    await client.close();
  });
});
