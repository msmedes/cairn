import {
  type Context,
  fauxAssistantMessage,
  fauxToolCall,
  type Model,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { SpawnSubagentResult } from "../subagents/spawn-subagent";

export function getFakeSpawnSubagentResultFromEnv():
  | ((input: {
      projectRoot: string;
      skillName: string;
      args: Record<string, unknown>;
      responseSchema: string;
      signal?: AbortSignal;
    }) => Promise<SpawnSubagentResult>)
  | undefined {
  const raw = process.env.CAIRN_FAKE_SPAWN_SUBAGENT_RESULT;
  if (!raw) return undefined;

  return async () => JSON.parse(raw) as SpawnSubagentResult;
}

function findLastToolResultText(context: Context) {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message.role !== "toolResult") continue;
    return message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("");
  }
  return "";
}

function getFakeProtocolSpawnModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_SPAWN_SUBAGENT !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "spawn_subagent",
        {
          skill_name: "write-prd",
          args: { slice: "first" },
          response_schema: "task_outcome",
        },
        { id: "tool-spawn-subagent" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `spawn_subagent result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolUpdateTaskStatusModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_UPDATE_TASK_STATUS !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "update_task_status",
        {
          task_slug: "preview-it-as-a-learner",
          status: "done",
        },
        { id: "tool-update-task-status" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `update_task_status result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolCreateTasksModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_CREATE_TASKS !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "create_tasks_artifact",
        {
          issues: [
            {
              issue_path: "issues/01-create-the-first-quiz-draft.md",
              title: "Create the first quiz draft",
            },
            {
              issue_path: "issues/02-preview-it-as-a-learner.md",
              title: "Preview it as a learner",
            },
          ],
        },
        { id: "tool-create-tasks" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `create_tasks_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolCreateBriefModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_CREATE_BRIEF !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "create_brief_artifact",
        {
          title: "Video Quiz Helper",
          summary:
            "A small tool for turning training videos into simple quizzes.",
          audience: "Team leads who need lightweight training checks.",
          success:
            "A lead can paste in a video, add questions, and share the quiz.",
          sections: [
            {
              heading: "What it does first",
              body: "It helps a lead create one quiz from one training video.",
            },
          ],
        },
        { id: "tool-create-brief" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `create_brief_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolUpdateBriefModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_UPDATE_BRIEF !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "update_brief_artifact",
        {
          title: "Focused Video Quiz Helper",
          summary:
            "A focused tool for turning one training video into a simple quiz.",
          audience: "Team leads who need lightweight training checks.",
          success:
            "A lead can paste in one video, add questions, and share the quiz.",
          sections: [
            {
              heading: "What it does first",
              body: "It helps a lead create one focused quiz from one training video.",
            },
          ],
          reason: "User narrowed the first version.",
        },
        { id: "tool-update-brief" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `update_brief_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolCreatePlanModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_CREATE_PLAN !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "create_plan_artifact",
        {
          title: "First playable quiz",
          summary: "Start with one video and one shareable quiz.",
          from_brief:
            "The brief asks for lightweight checks, so this proves one quiz end to end.",
          outcomes: ["You'll be able to paste in one training video."],
          pieces: [
            "Create the first quiz draft",
            "Preview it as a learner",
            "Share the finished quiz",
          ],
          not_yet: ["Team analytics", "Question banks"],
        },
        { id: "tool-create-plan" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `create_plan_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolUpdatePlanModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_UPDATE_PLAN !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "update_plan_artifact",
        {
          title: "Focused first quiz",
          summary: "Start with one video and a focused learner preview.",
          from_brief:
            "The brief asks for lightweight checks, so this proves the first quiz flow.",
          outcomes: ["You'll be able to paste in one training video."],
          pieces: [
            "Create the first quiz draft",
            "Preview it as a learner",
            "Share the finished quiz",
          ],
          not_yet: ["Team analytics", "Question banks"],
          reason: "User changed the first slice.",
        },
        { id: "tool-update-plan" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `update_plan_artifact result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolUpdateProjectContextModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_UPDATE_PROJECT_CONTEXT !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "update_project_context",
        {
          terms: [
            {
              name: "Instructor",
              definition: "The person creating lightweight checks for a team.",
            },
          ],
          constraints: ["Keep setup non-technical and app-owned."],
          decisions: ["Start with one video and one quiz."],
          open_questions: ["Who reviews generated questions?"],
        },
        { id: "tool-update-project-context" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `update_project_context result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolSetProjectNameModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  if (process.env.CAIRN_FAKE_PROTOCOL_SET_PROJECT_NAME !== "1") {
    return undefined;
  }

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([
    fauxAssistantMessage([
      fauxToolCall(
        "set_project_name",
        { name: "Renamed Project" },
        { id: "tool-set-project-name" },
      ),
    ]),
    (context) =>
      fauxAssistantMessage(
        `set_project_name result: ${findLastToolResultText(context)}`,
      ),
  ]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

function getFakeProtocolTextModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  const text = process.env.CAIRN_FAKE_PROTOCOL_TEXT_RESPONSE;
  if (!text) return undefined;

  const registration = registerFauxProvider({
    provider: "cairn-protocol-test",
    models: [{ id: "cairn-protocol-test-model" }],
  });
  registration.setResponses([fauxAssistantMessage(text)]);
  const model = registration.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, "cairn-protocol-test-key");
  return { model, authStorage };
}

export function getFakeProtocolModel():
  | { model: Model<string>; authStorage: AuthStorage }
  | undefined {
  return (
    getFakeProtocolSpawnModel() ??
    getFakeProtocolUpdateTaskStatusModel() ??
    getFakeProtocolCreateTasksModel() ??
    getFakeProtocolCreateBriefModel() ??
    getFakeProtocolUpdateBriefModel() ??
    getFakeProtocolCreatePlanModel() ??
    getFakeProtocolUpdatePlanModel() ??
    getFakeProtocolUpdateProjectContextModel() ??
    getFakeProtocolSetProjectNameModel() ??
    getFakeProtocolTextModel()
  );
}
