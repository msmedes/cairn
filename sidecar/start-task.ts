import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { CairnDir } from "./cairn-dir";
import { CAIRN_EXTENSION_FACTORIES } from "./pi-extensions";

export type StartTaskOutcome = "complete" | "failure" | "blocked";

export type StartTaskResult = {
  outcome: StartTaskOutcome;
  message: string;
};

export type PiSubAgentResult = {
  stopReason?: string;
  errorMessage?: string;
  finalText?: string;
};

export type RunSubAgent = (input: {
  cwd: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<PiSubAgentResult>;

export type StartTaskInput = {
  projectRoot: string;
  issuePath: string;
  signal?: AbortSignal;
  runSubAgent?: RunSubAgent;
};

const FALLBACK_MESSAGE =
  "The sub-agent ended without a recognized task outcome.";

function shortMessage(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 240) : fallback;
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

export function mapSubAgentResult(result: PiSubAgentResult): StartTaskResult {
  if (result.stopReason === "error") {
    return {
      outcome: "failure",
      message: shortMessage(
        result.errorMessage,
        "The sub-agent failed before finishing this piece.",
      ),
    };
  }

  if (result.stopReason === "aborted") {
    return {
      outcome: "blocked",
      message: shortMessage(
        result.errorMessage,
        "The sub-agent was stopped before finishing this piece.",
      ),
    };
  }

  if (
    result.stopReason &&
    result.stopReason !== "end_turn" &&
    result.stopReason !== "stop"
  ) {
    return {
      outcome: "failure",
      message: shortMessage(
        result.errorMessage,
        "The sub-agent stopped before producing a normal completion.",
      ),
    };
  }

  const parsed = extractJsonObject(result.finalText ?? "");
  if (!parsed || typeof parsed !== "object") {
    return { outcome: "failure", message: FALLBACK_MESSAGE };
  }

  const outcome = "outcome" in parsed ? parsed.outcome : undefined;
  if (
    outcome !== "complete" &&
    outcome !== "failure" &&
    outcome !== "blocked"
  ) {
    return { outcome: "failure", message: FALLBACK_MESSAGE };
  }

  return {
    outcome,
    message: shortMessage(
      "message" in parsed ? parsed.message : undefined,
      FALLBACK_MESSAGE,
    ),
  };
}

function resolveProjectPath(projectRoot: string, projectRelativePath: string) {
  if (isAbsolute(projectRelativePath)) {
    throw new Error("start_task issuePath must be project-relative.");
  }

  const normalized = normalize(projectRelativePath);
  if (normalized.startsWith("..")) {
    throw new Error("start_task issuePath must stay inside the project.");
  }

  const cairnRoot = CairnDir.root(projectRoot);
  const resolved = join(cairnRoot, normalized);
  if (relative(cairnRoot, resolved).startsWith("..")) {
    throw new Error("start_task issuePath must stay inside the project.");
  }
  return resolved;
}

function findSourcePrdPath(issueMarkdown: string) {
  const sourceSection = issueMarkdown.match(
    /## Source\s+([\s\S]*?)(?:\n## |$)/,
  );
  const sourceText = sourceSection?.[1] ?? issueMarkdown;
  const backticked = sourceText.match(/`([^`]+\.md)`/);
  if (backticked?.[1]) return backticked[1];
  const plain = sourceText.match(/(?:^|\s)([^\s`]+\.md)(?:\s|$)/);
  return plain?.[1] ?? null;
}

export function buildStartTaskPrompt(input: {
  issuePath: string;
  issueMarkdown: string;
  prdPath: string;
  prdMarkdown: string;
}) {
  return `You are a Cairn Sub-agent working inside the active Project working tree.

Implement exactly the issue below. Use red-green TDD: for each acceptance criterion, write or update a test first, run it and confirm it fails for the expected reason, then make the smallest implementation change that passes it. Re-run the relevant verification before you stop.

Return only one JSON object with this exact shape:
{ "outcome": "complete" | "failure" | "blocked", "message": string }

Use "complete" only when the implementation and relevant verification pass. Use "failure" when an autonomous retry could plausibly succeed. Use "blocked" when product input, missing external capability, or a contract mismatch prevents safe progress. Keep message short and factual.

Issue file: ${input.issuePath}

${input.issueMarkdown}

Source PRD: ${input.prdPath}

${input.prdMarkdown}
`;
}

function getLastAssistantText(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    return message.content
      .flatMap((part) =>
        part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("");
  }
  return "";
}

export async function runPiSubAgent({
  cwd,
  prompt,
  signal,
}: {
  cwd: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<PiSubAgentResult> {
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    extensionFactories: CAIRN_EXTENSION_FACTORIES,
    systemPromptOverride: () =>
      "You are a headless Cairn Sub-agent. Do the assigned coding work silently and return the requested structured JSON only.",
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
  });
  await session.bindExtensions({
    onError: (err) => {
      console.error(`Extension error (${err.extensionPath}): ${err.error}`);
    },
  });

  let terminal: PiSubAgentResult = {};
  const abort = () => session.dispose();
  signal?.addEventListener("abort", abort, { once: true });
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      terminal = {
        ...terminal,
        stopReason: event.message.stopReason,
        errorMessage: event.message.errorMessage,
        finalText: getLastAssistantText([event.message]),
      };
    }
    if (event.type === "agent_end") {
      terminal = {
        ...terminal,
        finalText: terminal.finalText || getLastAssistantText(event.messages),
      };
    }
  });

  try {
    if (signal?.aborted) {
      return { stopReason: "aborted", errorMessage: "Task was cancelled." };
    }
    await session.prompt(prompt);
    return terminal;
  } catch (err) {
    return {
      stopReason: signal?.aborted ? "aborted" : "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      finalText: terminal.finalText,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}

export async function startTask(
  input: StartTaskInput,
): Promise<StartTaskResult> {
  let issueAbsolutePath: string;
  try {
    issueAbsolutePath = resolveProjectPath(input.projectRoot, input.issuePath);
  } catch (err) {
    return {
      outcome: "blocked",
      message: err instanceof Error ? err.message : "Invalid issue path.",
    };
  }
  if (!existsSync(issueAbsolutePath)) {
    return {
      outcome: "blocked",
      message: `Issue file not found: ${input.issuePath}`,
    };
  }

  const issueMarkdown = readFileSync(issueAbsolutePath, "utf8");
  const sourcePrdPath = findSourcePrdPath(issueMarkdown);
  if (!sourcePrdPath) {
    return {
      outcome: "blocked",
      message: "Issue file does not name a source PRD.",
    };
  }

  let prdAbsolutePath: string;
  try {
    prdAbsolutePath = resolveProjectPath(input.projectRoot, sourcePrdPath);
  } catch (err) {
    return {
      outcome: "blocked",
      message: err instanceof Error ? err.message : "Invalid source PRD path.",
    };
  }
  if (!existsSync(prdAbsolutePath)) {
    return {
      outcome: "blocked",
      message: `Source PRD not found: ${sourcePrdPath}`,
    };
  }

  const prompt = buildStartTaskPrompt({
    issuePath: input.issuePath,
    issueMarkdown,
    prdPath: sourcePrdPath,
    prdMarkdown: readFileSync(prdAbsolutePath, "utf8"),
  });

  let nativeResult: PiSubAgentResult;
  try {
    nativeResult = await (input.runSubAgent ?? runPiSubAgent)({
      cwd: input.projectRoot,
      prompt,
      signal: input.signal,
    });
  } catch (err) {
    nativeResult = {
      stopReason: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
  return mapSubAgentResult(nativeResult);
}
