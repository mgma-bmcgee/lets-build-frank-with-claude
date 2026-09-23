import { z } from 'zod';
import { defineTool, requireAzure } from './define.js';

export const listContainerApps = defineTool({
  name: 'list_container_apps',
  description:
    "Lists every container app in Frank's shared resource group with its URL, running status, latest revision and scale limits, and marks Frank's own app. Use it to see which classmates' apps are up; for one app's containers and revisions, use get_container_app.",
  input: z.object({}).strict(),
  output: z.object({
    summary: z.string().describe("One line: how many apps, how many are running, and how Frank's own app is doing."),
    resourceGroup: z.string().describe('The resource group that was read. Set by Frank, not by the caller.'),
    count: z.number().int().nonnegative().describe('Number of container apps returned.'),
    truncated: z.boolean().describe('True when Azure had more apps than Frank returns in one call.'),
    apps: z
      .array(
        z.object({
          name: z.string(),
          fqdn: z.string().nullable(),
          provisioningState: z.string().nullable(),
          runningStatus: z.string().nullable(),
          latestRevision: z.string().nullable(),
          latestReadyRevision: z.string().nullable(),
          minReplicas: z.number().nullable(),
          maxReplicas: z.number().nullable(),
          isSelf: z.boolean(),
        }),
      )
      .describe("Each app's public hostname, provisioning and running status, revisions, replica limits, and whether it is Frank."),
  }),
  handler: async (_args, ctx) => {
    const azure = requireAzure(ctx);
    const { items, truncated } = await azure.listContainerApps();
    const self = ctx.config.selfAppName;
    const apps = items.map((a) => ({ ...a, isSelf: self !== null && a.name.toLowerCase() === self }));

    const running = apps.filter((a) => a.runningStatus?.toLowerCase() === 'running').length;
    const mine = apps.find((a) => a.isSelf);
    const yours = mine ? `; Frank's own app is ${mine.runningStatus?.toLowerCase() ?? 'in an unknown state'}` : '';
    const cut = truncated ? ' (Azure had more; this list is cut short)' : '';
    return {
      summary: `${apps.length} container app${apps.length === 1 ? '' : 's'} in ${azure.resourceGroup}, ${running} running${yours}${cut}.`,
      resourceGroup: azure.resourceGroup,
      count: apps.length,
      truncated,
      apps,
    };
  },
});
