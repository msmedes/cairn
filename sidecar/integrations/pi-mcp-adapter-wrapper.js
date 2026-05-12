import { loadMcpConfig } from "pi-mcp-adapter/config.js";
import mcpAdapter from "pi-mcp-adapter/index.ts";

const CAIRN_MCP_META_KEY = "_cairn";
const CAIRN_MANAGED_SERVERS = new Set(["notion", "slack"]);

function isCairnManagedServer(name, definition) {
  return (
    CAIRN_MANAGED_SERVERS.has(name) &&
    definition &&
    typeof definition === "object" &&
    definition[CAIRN_MCP_META_KEY] &&
    typeof definition[CAIRN_MCP_META_KEY] === "object" &&
    definition[CAIRN_MCP_META_KEY].managed === true
  );
}

function hasOnlyCairnManagedServers() {
  const config = loadMcpConfig();
  return Object.entries(config.mcpServers).every(([name, definition]) =>
    isCairnManagedServer(name, definition),
  );
}

export default function cairnMcpAdapter(pi) {
  if (!hasOnlyCairnManagedServers()) {
    console.warn(
      "MCP: external MCP config detected; Cairn will not expose it without an explicit managed setup.",
    );
    return;
  }

  return mcpAdapter(pi);
}
