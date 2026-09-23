// The one way to build a Frank tool. It turns ADR-002 from a review checklist
// into something the compiler and the server enforce:
//   - names are verb_noun with a verb from get|list|search|summarize
//   - input is a .strict() zod object, so unknown fields are rejected
//   - output is structured JSON with a top-level `summary`
//   - errors come back as isError with a plain-language message, never a stack
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Config } from '../config.js';

export const TOOL_VERBS = ['get', 'list', 'search', 'summarize'] as const;
export const TOOL_NAME_PATTERN = /^(get|list|search|summarize)_[a-z0-9]+(_[a-z0-9]+)*$/;

type ToolName = `${(typeof TOOL_VERBS)[number]}_${string}`;

// A strict object schema. Passing the schema instance (not a raw shape) to
// registerTool is what keeps .strict() in force — a raw shape is rebuilt by
// the SDK as a plain z.object(), which silently drops unknown fields.
type StrictInput = z.ZodObject<z.ZodRawShape, z.core.$strict>; // checked at runtime too (isStrict)
type Output = z.ZodObject<{ summary: z.ZodString } & z.ZodRawShape>;

export interface ToolContext {
  config: Config;
  startedAt: Date;
}

export interface Tool<I extends StrictInput = StrictInput, O extends Output = Output> {
  name: ToolName;
  /** One or two sentences, written for a model deciding whether to call the tool. */
  description: string;
  input: I;
  output: O;
  handler: (args: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>> | z.infer<O>;
}

/**
 * A failure a tool reports on purpose. Its message is shown to the caller
 * as-is, so it must be plain language (e.g. "Azure is not configured: ...").
 */
export class ToolError extends Error {
  override name = 'ToolError';
}

export function defineTool<I extends StrictInput, O extends Output>(tool: Tool<I, O>): Tool<I, O> {
  if (!TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(
      `Tool name '${tool.name}' breaks ADR-002: use verb_noun in lower snake_case with a verb from ${TOOL_VERBS.join('|')}.`,
    );
  }
  // The type above cannot tell z.object() from z.object().strict(), so check at
  // load time: a strict object rejects unknown keys via a `never` catchall.
  if (!isStrict(tool.input)) {
    throw new Error(`Tool '${tool.name}' breaks ADR-002: its input schema must be z.object({...}).strict().`);
  }
  return tool;
}

export function isStrict(schema: z.ZodObject): boolean {
  return schema._zod.def.catchall?._zod.def.type === 'never';
}

export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function registerTool(server: McpServer, tool: Tool, ctx: ToolContext): void {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.input, outputSchema: tool.output },
    async (args: unknown): Promise<CallToolResult> => {
      try {
        const result = await tool.handler(args as z.infer<StrictInput>, ctx);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        if (err instanceof ToolError) return toolError(err.message);
        // Unexpected failures stay in Frank's logs; the caller gets no internals.
        console.error(`[frank] ${tool.name} failed:`, err);
        return toolError(`${tool.name} failed unexpectedly. Frank's logs have the details.`);
      }
    },
  );
}
