import { readFileSync } from "node:fs";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel, Type } from "@mariozechner/pi-ai";
import {
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  SessionManager,
  type Skill,
} from "@mariozechner/pi-coding-agent";

export const SPAWN_SUBAGENT_SKILL_NAMES = [
  "write-brief",
  "write-plan",
  "write-tasks",
  "write-prd",
  "write-issue",
  "implement-issue",
  "verify-slice",
] as const;

export const SPAWN_SUBAGENT_RESPONSE_SCHEMAS = [
  "task_outcome",
  "verify_result",
  "artifact_write",
] as const;

export type SpawnSubagentSkillName =
  (typeof SPAWN_SUBAGENT_SKILL_NAMES)[number];

export type SpawnSubagentResponseSchema =
  (typeof SPAWN_SUBAGENT_RESPONSE_SCHEMAS)[number];

export type TaskOutcomeResult = {
  outcome: "complete" | "failure" | "blocked";
  message: string;
};

export type VerifyResult = { ok: boolean; message: string };

export type ArtifactWriteResult = {
  outcome: "complete" | "failure" | "blocked";
  message: string;
  path: string;
};

export type SpawnSubagentResult =
  | TaskOutcomeResult
  | VerifyResult
  | ArtifactWriteResult;

export type PiSubAgentResult = {
  stopReason?: string;
  errorMessage?: string;
  finalText?: string;
};

export type RunSubAgent = (input: {
  cwd: string;
  prompt: string;
  systemPrompt: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}) => Promise<PiSubAgentResult>;

export type SpawnSubagentInput = {
  projectRoot: string;
  skillName: SpawnSubagentSkillName;
  args: Record<string, unknown>;
  responseSchema: SpawnSubagentResponseSchema;
  loadedSkills: Skill[];
  signal?: AbortSignal;
  runSubAgent?: RunSubAgent;
  env?: NodeJS.ProcessEnv;
  customTools?: ReturnType<typeof createSpawnSubagentTool>[];
};

const MALFORMED_MESSAGE = "sub-agent returned a malformed result";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureForSchema(
  schema: SpawnSubagentResponseSchema,
  message: string,
): SpawnSubagentResult {
  switch (schema) {
    case "verify_result":
      return { ok: false, message };
    case "artifact_write":
      return { outcome: "failure", message, path: "" };
    case "task_outcome":
      return { outcome: "failure", message };
  }
}

function blockedForSchema(
  schema: SpawnSubagentResponseSchema,
  message: string,
): SpawnSubagentResult {
  if (schema === "verify_result") return { ok: false, message };
  if (schema === "artifact_write")
    return { outcome: "failure", message, path: "" };
  return { outcome: "blocked", message };
}

function normalizeParsedResult(
  parsed: unknown,
  schema: SpawnSubagentResponseSchema,
): SpawnSubagentResult | null {
  if (!isRecord(parsed)) return null;
  const message = shortMessage(parsed.message, MALFORMED_MESSAGE);

  if (schema === "verify_result") {
    if (typeof parsed.ok === "boolean") return { ok: parsed.ok, message };
    if (parsed.outcome === "blocked") return { ok: false, message };
    return null;
  }

  const outcome = parsed.outcome;
  if (
    outcome !== "complete" &&
    outcome !== "failure" &&
    outcome !== "blocked"
  ) {
    return null;
  }

  if (schema === "task_outcome") return { outcome, message };

  if (typeof parsed.path !== "string") return null;
  return { outcome, message, path: parsed.path };
}

export function mapSubAgentResult(
  result: PiSubAgentResult,
  schema: SpawnSubagentResponseSchema,
): SpawnSubagentResult {
  if (result.stopReason === "error") {
    return failureForSchema(
      schema,
      shortMessage(
        result.errorMessage,
        "The sub-agent failed before finishing.",
      ),
    );
  }

  if (result.stopReason === "aborted") {
    return blockedForSchema(
      schema,
      shortMessage(result.errorMessage, "Task was cancelled."),
    );
  }

  if (
    result.stopReason &&
    result.stopReason !== "end_turn" &&
    result.stopReason !== "stop"
  ) {
    return failureForSchema(
      schema,
      shortMessage(
        result.errorMessage,
        "The sub-agent stopped before producing a normal completion.",
      ),
    );
  }

  const parsed = extractJsonObject(result.finalText ?? "");
  const normalized = normalizeParsedResult(parsed, schema);
  if (normalized) return normalized;

  return failureForSchema(schema, MALFORMED_MESSAGE);
}

function responseShape(schema: SpawnSubagentResponseSchema) {
  switch (schema) {
    case "task_outcome":
      return '{ "outcome": "complete" | "failure" | "blocked", "message": string }';
    case "verify_result":
      return '{ "ok": boolean, "message": string }';
    case "artifact_write":
      return '{ "outcome": "complete" | "failure" | "blocked", "message": string, "path": string }';
  }
}

export function buildSpawnSubagentSystemPrompt(
  skillContent: string,
  responseSchema: SpawnSubagentResponseSchema,
) {
  return `${skillContent.trim()}

Structured response instruction:
return only one JSON object matching this exact shape for ${responseSchema}:
${responseShape(responseSchema)}

Do not include markdown fences, prose, or additional keys.`;
}

function readSkillContent(skill: Skill) {
  const raw = readFileSync(skill.filePath, "utf8");
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function parseDepth(env: NodeJS.ProcessEnv) {
  const raw = env.GUIDE_SUBAGENT_DEPTH;
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
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

async function withTemporaryEnv<T>(
  env: NodeJS.ProcessEnv,
  run: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function runPiSubAgent({
  cwd,
  prompt,
  systemPrompt,
  env,
  signal,
}: {
  cwd: string;
  prompt: string;
  systemPrompt: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<PiSubAgentResult> {
  return withTemporaryEnv(env, async () => {
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload();
    const loadedSkills = resourceLoader.getSkills().skills;

    const { session } = await createAgentSession({
      cwd,
      agentDir: getAgentDir(),
      resourceLoader,
      sessionManager: SessionManager.inMemory(cwd),
      model: getModel("anthropic", "claude-sonnet-4-6"),
      customTools: [
        createSpawnSubagentTool({
          projectRoot: cwd,
          getLoadedSkills: () => loadedSkills,
        }),
      ],
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
  });
}

function createSpawnSubagentTool(options: {
  projectRoot: string;
  getLoadedSkills: () => Skill[];
}) {
  return defineTool({
    name: "spawn_subagent",
    label: "Spawn Sub-agent",
    description:
      "Dispatch a nested headless Guide Sub-agent with a named skill, structured args, and an expected structured response schema.",
    parameters: Type.Object(
      {
        skill_name: Type.Union(
          SPAWN_SUBAGENT_SKILL_NAMES.map((name) => Type.Literal(name)),
        ),
        args: Type.Object({}, { additionalProperties: true }),
        response_schema: Type.Union(
          SPAWN_SUBAGENT_RESPONSE_SCHEMAS.map((name) => Type.Literal(name)),
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const result = await spawnSubagent({
        projectRoot: options.projectRoot,
        skillName: params.skill_name,
        args: params.args as Record<string, unknown>,
        responseSchema: params.response_schema,
        loadedSkills: options.getLoadedSkills(),
        signal,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}

export async function spawnSubagent(
  input: SpawnSubagentInput,
): Promise<SpawnSubagentResult> {
  const env = input.env ?? process.env;
  if (parseDepth(env) >= 2) {
    return {
      outcome: "blocked",
      message: "recursion depth limit reached",
    };
  }

  const skill = input.loadedSkills.find(
    (candidate) => candidate.name === input.skillName,
  );
  if (!skill) {
    return {
      outcome: "blocked",
      message: `skill ${input.skillName} not found`,
    };
  }

  let systemPrompt: string;
  try {
    systemPrompt = buildSpawnSubagentSystemPrompt(
      readSkillContent(skill),
      input.responseSchema,
    );
  } catch (err) {
    return failureForSchema(
      input.responseSchema,
      shortMessage(
        err instanceof Error ? err.message : String(err),
        "Could not read sub-agent skill.",
      ),
    );
  }

  const nextEnv = {
    ...env,
    GUIDE_SUBAGENT_DEPTH: String(parseDepth(env) + 1),
  };
  let nativeResult: PiSubAgentResult;
  try {
    nativeResult = await (input.runSubAgent ?? runPiSubAgent)({
      cwd: input.projectRoot,
      prompt: JSON.stringify(input.args),
      systemPrompt,
      env: nextEnv,
      signal: input.signal,
    });
  } catch (err) {
    nativeResult = {
      stopReason: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
  return mapSubAgentResult(nativeResult, input.responseSchema);
}
