import { z } from 'zod';
import { defineTool } from './define.js';

export const getStatus = defineTool({
  name: 'get_status',
  description:
    "Returns Frank's version, uptime and a greeting. Call it to check that Frank is reachable and which build is running; it needs no Azure access.",
  input: z.object({}).strict(),
  output: z.object({
    summary: z.string().describe('One-line, human-readable status.'),
    name: z.literal('frank').describe('Always "frank".'),
    version: z.string().describe("Frank's package version."),
    startedAt: z.string().describe('When this Frank process started, ISO 8601 UTC.'),
    uptimeSeconds: z.number().int().nonnegative().describe('Seconds since this process started.'),
    greeting: z.string().describe('A friendly hello.'),
  }),
  handler: (_args, { config, startedAt }) => {
    const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
    return {
      summary: `Frank ${config.version} is up (${uptimeSeconds}s).`,
      name: 'frank' as const,
      version: config.version,
      startedAt: startedAt.toISOString(),
      uptimeSeconds,
      greeting: "Hi, I'm Frank. I can look, but I don't touch.",
    };
  },
});
