// Frank's only door into Azure (ADR-009). Nothing else in src/ may import
// @azure/*; test/readonly.test.ts enforces that.
//
// The credential Frank holds is Contributor (ADR-010), so this file is the
// read-only guarantee. It exposes exactly three reads, all HTTP GETs:
//   resources.listByResourceGroup, containerApps.listByResourceGroup and .get,
//   containerAppsRevisions.listRevisions.
// Never add an operation that writes or that returns secrets. In particular
// listSecrets and getAuthToken, despite their names, must stay out.
import { ContainerAppsAPIClient, type ContainerApp, type Revision } from '@azure/arm-appcontainers';
import { ResourceManagementClient } from '@azure/arm-resources';
import { isRestError, type HttpClient, type PipelineRetryOptions } from '@azure/core-rest-pipeline';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import type { AzureScope, Config } from './config.js';
import { ToolError } from './tools/define.js';

/** Most items any list returns; the tools say so in `summary` when they hit it. */
export const MAX_ITEMS = 200;
const TIMEOUT_MS = 10_000;

export interface Listing<T> {
  items: T[];
  truncated: boolean;
}

export interface ResourceSummary {
  name: string;
  type: string;
  location: string;
  provisioningState: string | null;
}

export interface ContainerAppSummary {
  name: string;
  fqdn: string | null;
  provisioningState: string | null;
  runningStatus: string | null;
  latestRevision: string | null;
  latestReadyRevision: string | null;
  minReplicas: number | null;
  maxReplicas: number | null;
}

export interface ContainerAppDetail extends ContainerAppSummary {
  ingress: { external: boolean; targetPort: number | null } | null;
  /** Environment variable NAMES only. Values and secret references never leave this file. */
  containers: Array<{ name: string; image: string | null; envVarNames: string[] }>;
  revisions: Array<{
    name: string;
    active: boolean | null;
    replicas: number | null;
    trafficWeight: number | null;
    healthState: string | null;
    runningState: string | null;
    createdTime: string | null;
  }>;
}

export interface AzureGateway {
  readonly resourceGroup: string;
  listResources(): Promise<Listing<ResourceSummary>>;
  listContainerApps(): Promise<Listing<ContainerAppSummary>>;
  /** null when no app of that name exists in the group. */
  getContainerApp(name: string): Promise<ContainerAppDetail | null>;
}

/** Test seams. Production passes none of these. */
export interface GatewayOptions {
  makeCredential?: () => TokenCredential;
  httpClient?: HttpClient;
  retryOptions?: PipelineRetryOptions;
}

/**
 * Returns null unless every Azure variable is set, and only then builds a
 * credential. That order is what keeps DefaultAzureCredential from falling
 * back to a developer's `az login` (ADR-009).
 */
export function createAzureGateway(config: Config, options: GatewayOptions = {}): AzureGateway | null {
  if (!config.azure) return null;
  const scope = config.azure;
  const credential = (options.makeCredential ?? (() => new DefaultAzureCredential()))();
  const clientOptions = { httpClient: options.httpClient, retryOptions: options.retryOptions };
  const resources = new ResourceManagementClient(credential, scope.subscriptionId, clientOptions);
  const apps = new ContainerAppsAPIClient(credential, scope.subscriptionId, clientOptions);
  const rg = scope.resourceGroup;

  return {
    resourceGroup: rg,

    listResources: () =>
      guarded(scope, () =>
        take(resources.resources.listByResourceGroup(rg, { expand: 'provisioningState', abortSignal: timeout() }), (r) => ({
          name: r.name ?? '',
          type: r.type ?? '',
          location: r.location ?? '',
          provisioningState: r.provisioningState ?? null,
        })),
      ),

    listContainerApps: () =>
      guarded(scope, () => take(apps.containerApps.listByResourceGroup(rg, { abortSignal: timeout() }), summarize)),

    getContainerApp: (name) =>
      guarded(scope, async () => {
        let app: ContainerApp;
        try {
          app = await apps.containerApps.get(rg, name, { abortSignal: timeout() });
        } catch (err) {
          if (isRestError(err) && err.statusCode === 404) return null;
          throw err;
        }
        const revisions = await take(apps.containerAppsRevisions.listRevisions(rg, name, { abortSignal: timeout() }), revision);
        return {
          ...summarize(app),
          ingress: app.configuration?.ingress
            ? { external: app.configuration.ingress.external ?? false, targetPort: app.configuration.ingress.targetPort ?? null }
            : null,
          containers: (app.template?.containers ?? []).map((c) => ({
            name: c.name ?? '',
            image: c.image ?? null,
            envVarNames: (c.env ?? []).map((e) => e.name ?? '').filter(Boolean),
          })),
          revisions: revisions.items,
        };
      }),
  };
}

function timeout(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS);
}

async function take<T, U>(pages: AsyncIterable<T>, map: (item: T) => U): Promise<Listing<U>> {
  const items: U[] = [];
  for await (const item of pages) {
    if (items.length === MAX_ITEMS) return { items, truncated: true };
    items.push(map(item));
  }
  return { items, truncated: false };
}

function summarize(app: ContainerApp): ContainerAppSummary {
  return {
    name: app.name ?? '',
    fqdn: app.configuration?.ingress?.fqdn ?? null,
    provisioningState: app.provisioningState ?? null,
    runningStatus: app.runningStatus ?? null,
    latestRevision: app.latestRevisionName ?? null,
    latestReadyRevision: app.latestReadyRevisionName ?? null,
    minReplicas: app.template?.scale?.minReplicas ?? null,
    maxReplicas: app.template?.scale?.maxReplicas ?? null,
  };
}

function revision(r: Revision): ContainerAppDetail['revisions'][number] {
  return {
    name: r.name ?? '',
    active: r.active ?? null,
    replicas: r.replicas ?? null,
    trafficWeight: r.trafficWeight ?? null,
    healthState: r.healthState ?? null,
    runningState: r.runningState ?? null,
    createdTime: r.createdTime ? new Date(r.createdTime).toISOString() : null,
  };
}

/** Run an Azure read; anything that goes wrong becomes one plain sentence. */
async function guarded<T>(scope: AzureScope, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.error('[frank] Azure read failed:', err);
    throw new ToolError(describeAzureError(err, scope));
  }
}

export function describeAzureError(err: unknown, scope: AzureScope): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return `Azure didn't answer within ${TIMEOUT_MS / 1000} seconds. Try again.`;
  }
  if (name === 'CredentialUnavailableError' || name === 'AuthenticationError' || name === 'AggregateAuthenticationError') {
    return "Frank couldn't sign in to Azure. The classroom credential may have expired; ask your instructor.";
  }
  if (isRestError(err)) {
    const status = err.statusCode;
    if (status === 401) return 'Azure rejected Frank\'s credential (401). It may have expired; ask your instructor.';
    if (status === 403) return `Frank's credential isn't allowed to read ${scope.resourceGroup} (403).`;
    if (status === 404) return `Azure couldn't find resource group ${scope.resourceGroup} (404).`;
    if (status === 429) return 'Azure is throttling requests right now (429). Try again in a minute.';
    if (status !== undefined && status >= 500) return `Azure had a problem answering (${status}). Try again.`;
    if (status === undefined) return "Frank couldn't reach Azure. Check the network and try again.";
  }
  return 'Reading from Azure failed unexpectedly. Frank\'s logs have the details.';
}
