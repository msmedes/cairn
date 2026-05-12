import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import mcpAdapter from "./pi-mcp-adapter-wrapper.js";

export const CAIRN_EXTENSION_FACTORIES: ExtensionFactory[] = [mcpAdapter];
