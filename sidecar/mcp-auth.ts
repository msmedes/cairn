import { loadMcpConfig } from "pi-mcp-adapter/config.js";
import { authenticate, supportsOAuth } from "pi-mcp-adapter/mcp-auth-flow.js";

export type McpAuthStatus = "authenticated" | "expired" | "not_authenticated";

export async function authenticateConfiguredMcpServer(
  serverName: string,
): Promise<McpAuthStatus> {
  const config = loadMcpConfig();
  const definition = config.mcpServers[serverName];
  if (!definition) {
    throw new Error(`MCP server "${serverName}" is not configured.`);
  }
  if (!supportsOAuth(definition)) {
    throw new Error(`MCP server "${serverName}" does not use OAuth.`);
  }
  if (!definition.url) {
    throw new Error(`MCP server "${serverName}" has no URL configured.`);
  }

  return authenticate(serverName, definition.url, definition);
}
