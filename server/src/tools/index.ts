// Every tool Frank exposes. Adding one means a module here plus a test; the
// conventions test checks every entry in this list against ADR-002.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type Tool, type ToolContext } from './define.js';
import { getStatus } from './get_status.js';
import { listContainerApps } from './list_container_apps.js';
import { listResources } from './list_resources.js';

export const tools: Tool[] = [getStatus, listResources, listContainerApps];

export function registerTools(server: McpServer, ctx: ToolContext): void {
  for (const tool of tools) registerTool(server, tool, ctx);
}
