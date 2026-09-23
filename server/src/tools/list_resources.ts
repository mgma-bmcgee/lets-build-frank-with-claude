import { z } from 'zod';
import { defineTool, requireAzure } from './define.js';

export const listResources = defineTool({
  name: 'list_resources',
  description:
    "Lists every Azure resource in Frank's resource group (shared by the whole class), with type, location and provisioning state, and marks Frank's own app. Use it to see what exists; for a container app's health and revisions, use list_container_apps or get_container_app.",
  input: z
    .object({
      type: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe('Only return resources of this full ARM type, e.g. "Microsoft.App/containerApps". Case-insensitive.'),
    })
    .strict(),
  output: z.object({
    summary: z.string().describe('One line: how many resources, of how many types, and whether the list was cut short.'),
    resourceGroup: z.string().describe('The resource group that was read. Set by Frank, not by the caller.'),
    count: z.number().int().nonnegative().describe('Number of resources returned.'),
    truncated: z.boolean().describe('True when Azure had more resources than Frank returns in one call.'),
    resources: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
          location: z.string(),
          provisioningState: z.string().nullable(),
          isSelf: z.boolean(),
        }),
      )
      .describe("Each resource's name, ARM type, location, provisioning state, and whether it is Frank's own app."),
  }),
  handler: async ({ type }, ctx) => {
    const azure = requireAzure(ctx);
    const { items, truncated } = await azure.listResources();
    const wanted = type?.toLowerCase();
    const self = ctx.config.selfAppName;
    const resources = items
      .filter((r) => !wanted || r.type.toLowerCase() === wanted)
      .map((r) => ({
        ...r,
        isSelf: self !== null && r.type.toLowerCase() === 'microsoft.app/containerapps' && r.name.toLowerCase() === self,
      }));

    const types = new Set(resources.map((r) => r.type)).size;
    const what = wanted ? `${resources.length} ${type} resource${resources.length === 1 ? '' : 's'}` : `${resources.length} resource${resources.length === 1 ? '' : 's'} of ${types} type${types === 1 ? '' : 's'}`;
    const cut = truncated ? ' (Azure had more; this list is cut short)' : '';
    return {
      summary: `${what} in ${azure.resourceGroup}${cut}.`,
      resourceGroup: azure.resourceGroup,
      count: resources.length,
      truncated,
      resources,
    };
  },
});
