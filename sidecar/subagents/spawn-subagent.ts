import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  SessionManager,
  type Skill,
} from "@mariozechner/pi-coding-agent";
import { z } from "zod";
import {
  createTasksArtifactToolParamsSchema,
  PlanArtifactToolParamsSchema,
  paramsToBriefData,
  paramsToPlanData,
  paramsToTaskIssues,
  updateBriefArtifactToolParamsSchema,
  updatePlanArtifactToolParamsSchema,
} from "../artifacts/artifact-tool-params";
import {
  BriefArtifactDataSchema,
  createBriefArtifact,
  updateBriefArtifact,
} from "../artifacts/brief-artifact";
import {
  createPlanArtifact,
  updatePlanArtifact,
} from "../artifacts/plan-artifact";
import { createTasksArtifact } from "../artifacts/tasks-artifact";
import { toolSchemaFromZod } from "../artifacts/tool-schema";
import { CAIRN_EXTENSION_FACTORIES } from "../integrations/pi-extensions";
import { CairnDir } from "../project/cairn-dir";
import {
  ProjectContextUpdateToolParamsSchema,
  paramsToProjectContextUpdates,
  updateProjectContext,
} from "../project/project-context";

export const SPAWN_SUBAGENT_SKILL_NAMES = [
  "write-brief",
  "write-plan",
  "write-tasks",
  "write-prd",
  "write-issue",
  "implement-issue",
  "review-issue",
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
  sessionFile?: string;
  finishResult?: unknown;
};

export type RunSubAgent = (input: {
  cwd: string;
  prompt: string;
  systemPrompt: string;
  skillPaths: string[];
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

const SpawnSubagentToolParamsSchema = z.object({
  skill_name: z
    .enum(SPAWN_SUBAGENT_SKILL_NAMES)
    .describe("Known Cairn sub-agent skill name to run."),
  args: z
    .record(z.string(), z.unknown())
    .describe("Structured handoff arguments for the selected skill."),
  response_schema: z
    .enum(SPAWN_SUBAGENT_RESPONSE_SCHEMAS)
    .describe("Expected structured response shape from the selected skill."),
});

const subagentOutcomeSchema = z.enum(["complete", "failure", "blocked"]);

const FinishSubagentToolParamsSchema = z.union([
  z.object({
    outcome: subagentOutcomeSchema,
    message: z.string(),
  }),
  z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
  z.object({
    outcome: subagentOutcomeSchema,
    message: z.string(),
    path: z.string(),
  }),
]);

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

  const parsed =
    result.finishResult ?? extractJsonObject(result.finalText ?? "");
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
  responseSchema: SpawnSubagentResponseSchema,
) {
  return `You are a headless Cairn Sub-agent. The user message invokes the assigned skill with /skill:name; load and follow that skill using pi's native skill expansion. Also load and apply any matching available skills, especially quality-code for TypeScript or full-stack implementation/review work.

Structured response instruction:
When the work is complete, do not write a final prose answer. Call the finish_subagent tool exactly once with arguments matching this exact shape for ${responseSchema}:
${responseShape(responseSchema)}

The finish_subagent tool call is the only completion signal. Do not include markdown fences, prose, or additional keys.`;
}

function buildSpawnSubagentPrompt(
  skillName: SpawnSubagentSkillName,
  args: Record<string, unknown>,
) {
  return `/skill:${skillName} ${JSON.stringify(args, null, 2)}`;
}

function parseDepth(env: NodeJS.ProcessEnv) {
  const raw = env.CAIRN_SUBAGENT_DEPTH;
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

export function getSubagentSessionDir(projectRoot: string) {
  return join(CairnDir.sessionsDir(projectRoot), "subagents");
}

function createFinishSubagentTool(options: {
  onFinish: (result: unknown) => void;
}) {
  return defineTool({
    name: "finish_subagent",
    label: "Finish Sub-agent",
    description:
      "Finish this sub-agent run with the structured result requested by the handoff. Call this exactly once instead of writing a final prose answer.",
    promptSnippet: "Finish this sub-agent run with a structured result",
    promptGuidelines: [
      "Call finish_subagent exactly once when the sub-agent work is complete.",
      "Do not write a final prose answer after finish_subagent; the tool call is the completion signal.",
    ],
    parameters: toolSchemaFromZod(FinishSubagentToolParamsSchema),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      options.onFinish(params);
      return {
        content: [
          {
            type: "text",
            text: "Sub-agent result recorded.",
          },
        ],
        details: params,
      };
    },
  });
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
  skillPaths,
  env,
  signal,
}: {
  cwd: string;
  prompt: string;
  systemPrompt: string;
  skillPaths: string[];
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<PiSubAgentResult> {
  return withTemporaryEnv(env, async () => {
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      additionalSkillPaths: skillPaths,
      extensionFactories: CAIRN_EXTENSION_FACTORIES,
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload();
    const loadedSkills = resourceLoader.getSkills().skills;

    const subagentSessionManager = SessionManager.create(
      cwd,
      getSubagentSessionDir(cwd),
    );

    let finishResult: unknown;

    const { session } = await createAgentSession({
      cwd,
      agentDir: getAgentDir(),
      resourceLoader,
      sessionManager: subagentSessionManager,
      model: getModel("anthropic", "claude-sonnet-4-6"),
      customTools: [
        createSpawnSubagentTool({
          projectRoot: cwd,
          getLoadedSkills: () => loadedSkills,
        }),
        createFinishSubagentTool({
          onFinish: (result) => {
            finishResult = result;
          },
        }),
        ...createSubagentArtifactTools({ projectRoot: cwd }),
        createSubagentUpdateProjectContextTool({ projectRoot: cwd }),
      ],
    });
    await session.bindExtensions({
      onError: (err) => {
        console.error(`Extension error (${err.extensionPath}): ${err.error}`);
      },
    });

    let terminal: PiSubAgentResult = {
      sessionFile: subagentSessionManager.getSessionFile(),
    };
    const abort = () => session.dispose();
    signal?.addEventListener("abort", abort, { once: true });
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        terminal = {
          ...terminal,
          finishResult,
          stopReason: event.message.stopReason,
          errorMessage: event.message.errorMessage,
          finalText: getLastAssistantText([event.message]),
        };
      }
      if (event.type === "agent_end") {
        terminal = {
          ...terminal,
          finishResult,
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
        finishResult,
        sessionFile: terminal.sessionFile,
      };
    } finally {
      signal?.removeEventListener("abort", abort);
      unsubscribe();
      session.dispose();
    }
  });
}

export function createSubagentArtifactTools(options: { projectRoot: string }) {
  return [
    defineTool({
      name: "create_brief_artifact",
      label: "Create Brief Artifact",
      description:
        "Create the Project Brief as schema-validated artifact data in brief.json. Use this instead of raw artifact writes.",
      parameters: toolSchemaFromZod(BriefArtifactDataSchema),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const result = await createBriefArtifact({
          projectRoot: options.projectRoot,
          data: paramsToBriefData(params),
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "update_brief_artifact",
      label: "Update Brief Artifact",
      description:
        "Replace the Project Brief artifact data in brief.json after the user changes the agreement. Requires a short reason.",
      parameters: toolSchemaFromZod(updateBriefArtifactToolParamsSchema),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const result = await updateBriefArtifact({
          projectRoot: options.projectRoot,
          data: paramsToBriefData(params),
          reason: params.reason,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "create_plan_artifact",
      label: "Create Plan Artifact",
      description:
        "Create the current Slice Plan as schema-validated artifact data in plan.json. Use this instead of raw artifact writes.",
      parameters: toolSchemaFromZod(PlanArtifactToolParamsSchema),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const result = await createPlanArtifact({
          projectRoot: options.projectRoot,
          data: paramsToPlanData(params),
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "update_plan_artifact",
      label: "Update Plan Artifact",
      description:
        "Replace the current Slice Plan artifact data in plan.json after the user changes the agreement. Requires a short reason.",
      parameters: toolSchemaFromZod(updatePlanArtifactToolParamsSchema),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const result = await updatePlanArtifact({
          projectRoot: options.projectRoot,
          data: paramsToPlanData(params),
          reason: params.reason,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "create_tasks_artifact",
      label: "Create Tasks Artifact",
      description:
        "Create the Tasks tab as schema-validated artifact data in tasks.json. Use this instead of raw artifact writes.",
      parameters: toolSchemaFromZod(createTasksArtifactToolParamsSchema),
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const result = await createTasksArtifact({
          projectRoot: options.projectRoot,
          issues: paramsToTaskIssues(params),
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
  ];
}

export function createSubagentUpdateProjectContextTool(options: {
  projectRoot: string;
}) {
  return defineTool({
    name: "update_project_context",
    label: "Update Project Context",
    description:
      "Capture durable Project facts, terms, constraints, decisions, and open questions in hidden CONTEXT.md. Use this instead of editing CONTEXT.md directly.",
    parameters: toolSchemaFromZod(ProjectContextUpdateToolParamsSchema),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const result = updateProjectContext({
        projectRoot: options.projectRoot,
        updates: paramsToProjectContextUpdates(params),
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
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
      "Dispatch a nested headless Cairn Sub-agent with a named skill, structured args, and an expected structured response schema.",
    parameters: toolSchemaFromZod(SpawnSubagentToolParamsSchema),
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

  if (!existsSync(skill.filePath)) {
    return failureForSchema(
      input.responseSchema,
      `Could not read sub-agent skill: ${skill.filePath}`,
    );
  }

  const systemPrompt = buildSpawnSubagentSystemPrompt(input.responseSchema);
  const prompt = buildSpawnSubagentPrompt(input.skillName, input.args);
  const skillPaths = input.loadedSkills.map(
    (loadedSkill) => loadedSkill.filePath,
  );

  const nextEnv = {
    ...env,
    CAIRN_SUBAGENT_DEPTH: String(parseDepth(env) + 1),
  };
  let nativeResult: PiSubAgentResult;
  try {
    nativeResult = await (input.runSubAgent ?? runPiSubAgent)({
      cwd: input.projectRoot,
      prompt,
      systemPrompt,
      skillPaths,
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
