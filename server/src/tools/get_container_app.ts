import { z } from 'zod';
import { defineTool, requireAzure, ToolError } from './define.js';

// Container Apps names: lowercase letters, digits and single hyphens, 2-32
// characters, starting with a letter. Anything else can't be an app here.
const APP_NAME = /^(?!.*--)[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

const revision = z.object({
  name: z.string(),
  active: z.boolean().nullable(),
  replicas: z.number().nullable(),
  trafficWeight: z.number().nullable(),
  healthState: z.string().nullable(),
  runningState: z.string().nullable(),
  createdTime: z.string().nullable(),
});

export const getContainerApp = defineTool({
  name: 'get_container_app',
  description:
    "Describes one container app in Frank's shared resource group: its image, ingress, scale limits, revisions with health, and the names (never the values) of its environment variables. Use list_container_apps first to find app names.",
  input: z
    .object({
      name: z
        .string()
        .regex(APP_NAME, 'Must be a Container Apps name: lowercase letters, digits and hyphens, 2-32 characters.')
        .describe('The container app to describe, e.g. "frank-octocat". Looked up only inside Frank\'s resource group.'),
    })
    .strict(),
  output: z.object({
    summary: z.string().describe('One line: whether the app is running, on which revision, and its health.'),
    resourceGroup: z.string().describe('The resource group the app was found in. Set by Frank, not by the caller.'),
    name: z.string().describe("The app's name."),
    isSelf: z.boolean().describe("True when this is Frank's own app."),
    fqdn: z.string().nullable().describe("The app's public hostname, if it has ingress."),
    provisioningState: z.string().nullable().describe("Azure's provisioning state for the app."),
    runningStatus: z.string().nullable().describe('Whether the app is running.'),
    latestRevision: z.string().nullable().describe('The newest revision.'),
    latestReadyRevision: z.string().nullable().describe('The newest revision that became ready.'),
    ingress: z
      .object({ external: z.boolean(), targetPort: z.number().nullable() })
      .nullable()
      .describe('Whether the app is reachable from the internet, and on which container port.'),
    scale: z.object({ minReplicas: z.number().nullable(), maxReplicas: z.number().nullable() }).describe('Replica limits.'),
    containers: z
      .array(z.object({ name: z.string(), image: z.string().nullable(), envVarNames: z.array(z.string()) }))
      .describe('Each container, its image, and the NAMES of its environment variables (values are never returned).'),
    revisions: z.array(revision).describe('Every revision with whether it is active, replicas, traffic share and health.'),
  }),
  handler: async ({ name }, ctx) => {
    const azure = requireAzure(ctx);
    const app = await azure.getContainerApp(name);
    if (!app) throw new ToolError(`No container app named '${name}' in ${azure.resourceGroup}.`);

    const { minReplicas, maxReplicas, ...rest } = app;
    const isSelf = ctx.config.selfAppName !== null && app.name.toLowerCase() === ctx.config.selfAppName;
    const current = app.revisions.find((r) => r.name === app.latestReadyRevision);
    const health = current?.healthState ? `, ${current.healthState.toLowerCase()}` : '';
    const replicas = current?.replicas != null ? `, ${current.replicas} replica${current.replicas === 1 ? '' : 's'}` : '';
    const state = app.runningStatus?.toLowerCase() ?? 'in an unknown state';
    const on = app.latestReadyRevision ? ` on ${app.latestReadyRevision}` : '';
    return {
      summary: `${app.name}${isSelf ? " (Frank's own app)" : ''} is ${state}${on}${health}${replicas}.`,
      resourceGroup: azure.resourceGroup,
      ...rest,
      isSelf,
      scale: { minReplicas, maxReplicas },
    };
  },
});
