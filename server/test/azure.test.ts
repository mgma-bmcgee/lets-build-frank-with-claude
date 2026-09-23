// The gateway, driven through the REAL Azure SDK clients with a fake HTTP layer.
// This checks the SDK's actual request building and response parsing, and
// records every request so the read-only guarantee can be asserted on the wire.
import {
  createHttpHeaders,
  type HttpClient,
  type PipelineRequest,
  type PipelineResponse,
  RestError,
} from '@azure/core-rest-pipeline';
import { describe, expect, it, vi } from 'vitest';
import { createAzureGateway, describeAzureError, MAX_ITEMS } from '../src/azure.js';
import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/tools/define.js';

const SUB = '00000000-0000-0000-0000-000000000001';
const RG = 'rg-frank-class';
const ENV = {
  AZURE_SUBSCRIPTION_ID: SUB,
  AZURE_RESOURCE_GROUP: RG,
  AZURE_CLIENT_ID: '00000000-0000-0000-0000-000000000002',
  AZURE_TENANT_ID: '00000000-0000-0000-0000-000000000003',
  AZURE_CLIENT_SECRET: 'placeholder-not-a-real-secret',
};
const RG_PATH = `/subscriptions/${SUB}/resourceGroups/${RG}/`;
// ARM paths are case-insensitive, and the SDKs disagree: arm-resources sends
// `resourcegroups`, arm-appcontainers `resourceGroups`. Compare lowercased.
const path = (req: PipelineRequest) => new URL(req.url).pathname.toLowerCase();
const LEAK = 'SHOULD-NOT-LEAK';

const fakeCredential = () => ({
  getToken: async () => ({ token: 'fake-token', expiresOnTimestamp: Date.now() + 3_600_000 }),
});

function app(name: string) {
  return {
    id: `${RG_PATH}providers/Microsoft.App/containerApps/${name}`,
    name,
    type: 'Microsoft.App/containerApps',
    location: 'eastus2',
    properties: {
      provisioningState: 'Succeeded',
      runningStatus: 'Running',
      latestRevisionName: `${name}--0000002`,
      latestReadyRevisionName: `${name}--0000002`,
      configuration: {
        ingress: { fqdn: `${name}.example.eastus2.azurecontainerapps.io`, external: true, targetPort: 3000 },
        secrets: [{ name: 'azure-client-secret', value: LEAK }],
      },
      template: {
        containers: [
          {
            name,
            image: `acr.azurecr.io/${name}:abc123`,
            env: [
              { name: 'AZURE_RESOURCE_GROUP', value: LEAK },
              { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' },
            ],
          },
        ],
        scale: { minReplicas: 0, maxReplicas: 1 },
      },
    },
  };
}

type Route = (req: PipelineRequest) => { status: number; body: unknown } | undefined;

/** A fake Azure: answers by URL and records every request it sees. */
function fakeAzure(route: Route) {
  const requests: PipelineRequest[] = [];
  const httpClient: HttpClient = {
    async sendRequest(request): Promise<PipelineResponse> {
      requests.push(request);
      const answer = route(request) ?? { status: 404, body: { error: { code: 'NotFound', message: 'no route' } } };
      return {
        request,
        status: answer.status,
        headers: createHttpHeaders({ 'content-type': 'application/json' }),
        bodyAsText: JSON.stringify(answer.body),
      };
    },
  };
  const gateway = createAzureGateway(loadConfig(ENV), {
    makeCredential: fakeCredential,
    httpClient,
    retryOptions: { maxRetries: 0 },
  })!;
  return { gateway, requests };
}

const standardRoutes: Route = (req) => {
  const p = path(req);
  if (p.endsWith(`${RG_PATH}resources`.toLowerCase())) {
    return {
      status: 200,
      body: {
        value: [
          { name: 'frank-mgma-bmcgee', type: 'Microsoft.App/containerApps', location: 'eastus2', provisioningState: 'Succeeded' },
          { name: 'acrfrankclass', type: 'Microsoft.ContainerRegistry/registries', location: 'eastus2', provisioningState: 'Succeeded' },
        ],
      },
    };
  }
  if (p.endsWith('/providers/microsoft.app/containerapps')) {
    return { status: 200, body: { value: [app('frank-mgma-bmcgee'), app('frank-octocat')] } };
  }
  if (p.endsWith('/containerapps/frank-octocat/revisions')) {
    return {
      status: 200,
      body: {
        value: [
          {
            name: 'frank-octocat--0000002',
            properties: { active: true, replicas: 1, trafficWeight: 100, healthState: 'Healthy', runningState: 'Running', createdTime: '2026-09-23T21:33:00Z' },
          },
        ],
      },
    };
  }
  if (p.endsWith('/containerapps/frank-octocat')) return { status: 200, body: app('frank-octocat') };
  return undefined;
};

describe('createAzureGateway', () => {
  it('returns null, and builds no credential, when any Azure variable is missing', () => {
    const makeCredential = vi.fn(fakeCredential);
    expect(createAzureGateway(loadConfig({ ...ENV, AZURE_CLIENT_SECRET: '' }), { makeCredential })).toBeNull();
    expect(createAzureGateway(loadConfig({}), { makeCredential })).toBeNull();
    expect(makeCredential).not.toHaveBeenCalled();
  });
});

describe('the gateway on the wire', () => {
  it('lists resources with provisioningState, asking for it explicitly', async () => {
    const { gateway, requests } = fakeAzure(standardRoutes);
    const result = await gateway.listResources();
    expect(result).toEqual({
      truncated: false,
      items: [
        { name: 'frank-mgma-bmcgee', type: 'Microsoft.App/containerApps', location: 'eastus2', provisioningState: 'Succeeded' },
        { name: 'acrfrankclass', type: 'Microsoft.ContainerRegistry/registries', location: 'eastus2', provisioningState: 'Succeeded' },
      ],
    });
    expect(new URL(requests[0]!.url).searchParams.get('$expand')).toBe('provisioningState');
  });

  it('summarizes container apps', async () => {
    const { gateway } = fakeAzure(standardRoutes);
    const { items } = await gateway.listContainerApps();
    expect(items.map((a) => a.name)).toEqual(['frank-mgma-bmcgee', 'frank-octocat']);
    expect(items[1]).toEqual({
      name: 'frank-octocat',
      fqdn: 'frank-octocat.example.eastus2.azurecontainerapps.io',
      provisioningState: 'Succeeded',
      runningStatus: 'Running',
      latestRevision: 'frank-octocat--0000002',
      latestReadyRevision: 'frank-octocat--0000002',
      minReplicas: 0,
      maxReplicas: 1,
    });
  });

  it('describes one app with env var NAMES only — no values, no secrets', async () => {
    const { gateway } = fakeAzure(standardRoutes);
    const detail = await gateway.getContainerApp('frank-octocat');
    expect(detail?.containers).toEqual([
      { name: 'frank-octocat', image: 'acr.azurecr.io/frank-octocat:abc123', envVarNames: ['AZURE_RESOURCE_GROUP', 'AZURE_CLIENT_SECRET'] },
    ]);
    expect(detail?.revisions).toEqual([
      {
        name: 'frank-octocat--0000002',
        active: true,
        replicas: 1,
        trafficWeight: 100,
        healthState: 'Healthy',
        runningState: 'Running',
        createdTime: '2026-09-23T21:33:00.000Z',
      },
    ]);
    expect(detail?.ingress).toEqual({ external: true, targetPort: 3000 });
    const everything = JSON.stringify(detail);
    expect(everything).not.toContain(LEAK);
    expect(everything).not.toContain('azure-client-secret');
  });

  it('returns null for an app that is not in the group', async () => {
    const { gateway } = fakeAzure(standardRoutes);
    await expect(gateway.getContainerApp('frank-nobody')).resolves.toBeNull();
  });

  it('only ever sends GETs, only inside the configured resource group', async () => {
    const { gateway, requests } = fakeAzure(standardRoutes);
    await gateway.listResources();
    await gateway.listContainerApps();
    await gateway.getContainerApp('frank-octocat');
    await gateway.getContainerApp('frank-nobody');
    expect(requests.length).toBeGreaterThanOrEqual(5);
    for (const req of requests) {
      expect(req.method, req.url).toBe('GET');
      expect(path(req), req.url).toContain(RG_PATH.toLowerCase());
    }
  });

  it(`stops at ${MAX_ITEMS} items and says the list was truncated`, async () => {
    const page = (from: number, count: number, next?: string) => ({
      value: Array.from({ length: count }, (_, i) => ({ name: `r${from + i}`, type: 't', location: 'l' })),
      ...(next ? { nextLink: next } : {}),
    });
    const { gateway, requests } = fakeAzure((req) => {
      const url = new URL(req.url);
      if (url.searchParams.get('page') === '2') return { status: 200, body: page(150, 150, `${url.origin}${url.pathname}?page=3`) };
      if (url.searchParams.get('page') === '3') return { status: 200, body: page(300, 150) };
      return { status: 200, body: page(0, 150, `${url.origin}${url.pathname}?page=2`) };
    });
    const result = await gateway.listResources();
    expect(result.items).toHaveLength(MAX_ITEMS);
    expect(result.truncated).toBe(true);
    expect(requests).toHaveLength(2); // never fetched page 3
  });

  it('turns Azure failures into one plain sentence', async () => {
    const { gateway } = fakeAzure(() => ({ status: 403, body: { error: { code: 'AuthorizationFailed', message: 'raw internals here' } } }));
    const failure = await gateway.listResources().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ToolError);
    expect((failure as Error).message).toBe(`Frank's credential isn't allowed to read ${RG} (403).`);
    expect((failure as Error).message).not.toContain('raw internals');
  });
});

describe('describeAzureError', () => {
  const scope = { subscriptionId: SUB, resourceGroup: RG };
  const named = (name: string) => Object.assign(new Error('x'), { name });

  it.each([
    [new RestError('x', { statusCode: 401 }), /rejected Frank's credential/],
    [new RestError('x', { statusCode: 404 }), /couldn't find resource group rg-frank-class/],
    [new RestError('x', { statusCode: 429 }), /throttling/],
    [new RestError('x', { statusCode: 503 }), /problem answering \(503\)/],
    [new RestError('x', { code: 'ENOTFOUND' }), /couldn't reach Azure/],
    [named('TimeoutError'), /didn't answer within 10 seconds/],
    [named('AbortError'), /didn't answer within 10 seconds/],
    [named('CredentialUnavailableError'), /couldn't sign in to Azure/],
    [named('AuthenticationError'), /couldn't sign in to Azure/],
    [new Error('anything else'), /failed unexpectedly/],
  ])('%s', (err, expected) => {
    const message = describeAzureError(err, scope);
    expect(message).toMatch(expected);
    expect(message).not.toMatch(/\n\s+at /);
  });
});
