import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { CAIRN_EXTENSION_FACTORIES } from "../../integrations/pi-extensions";

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("Cairn bundles the MCP adapter extension without relying on global Pi packages", async () => {
  const loader = new DefaultResourceLoader({
    cwd: tempDir("cairn-mcp-cwd-"),
    agentDir: tempDir("cairn-mcp-agent-"),
    noExtensions: true,
    extensionFactories: CAIRN_EXTENSION_FACTORIES,
  });

  await loader.reload();

  const extensions = loader.getExtensions();
  expect(extensions.errors).toEqual([]);
  expect(extensions.extensions).toHaveLength(1);

  const [mcpExtension] = extensions.extensions;
  expect(mcpExtension.tools.has("mcp")).toBe(true);
  expect(mcpExtension.commands.has("mcp")).toBe(true);
  expect(mcpExtension.commands.has("mcp-auth")).toBe(true);
  expect(mcpExtension.flags.has("mcp-config")).toBe(true);
});

test("Cairn binds bundled MCP extensions so the MCP tool initializes", async () => {
  const cwd = tempDir("cairn-mcp-cwd-");
  const agentDir = tempDir("cairn-mcp-agent-");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      extensionFactories: CAIRN_EXTENSION_FACTORIES,
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
    });
    await session.bindExtensions({});

    const mcpTool = loader
      .getExtensions()
      .extensions[0].tools.get("mcp")?.definition;
    if (!mcpTool) throw new Error("mcp tool was not registered");
    const context = {} as Parameters<typeof mcpTool.execute>[4];
    const result = await mcpTool?.execute(
      "manual",
      {},
      new AbortController().signal,
      () => {},
      context,
    );

    expect(result?.details).toEqual({
      mode: "status",
      servers: [],
      totalTools: 0,
      connectedCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain("not_initialized");
    session.dispose();
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  }
});

test("Cairn does not expose externally configured MCP servers by default", async () => {
  const cwd = tempDir("cairn-mcp-cwd-");
  const agentDir = tempDir("cairn-mcp-agent-");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        external: {
          url: "https://example.com/mcp",
          auth: "oauth",
        },
      },
    }),
    "utf8",
  );
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      extensionFactories: CAIRN_EXTENSION_FACTORIES,
    });
    await loader.reload();

    const extensions = loader.getExtensions();
    expect(extensions.errors).toEqual([]);
    expect(extensions.extensions).toHaveLength(1);
    expect(extensions.extensions[0].tools.has("mcp")).toBe(false);
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  }
});
