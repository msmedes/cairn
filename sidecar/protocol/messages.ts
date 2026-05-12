/**
 * Shared wire types between the sidecar (writer) and the React frontend
 * (reader). The Tauri Rust host is a transparent JSON forwarder, so the
 * frontend imports these directly to stay in lockstep with what the sidecar
 * emits.
 *
 * Only type definitions belong here. Anything with a runtime — schemas,
 * validators, helpers — should stay in its own module and be referenced from
 * here via type-only imports.
 */

import type {
  AskUserQuestionAnswer,
  AskUserQuestionBundle,
} from "../questions/ask-user-question-schema";
import type { HydrateEvent } from "./hydrate";

export type {
  AskUserQuestionAnswer,
  AskUserQuestionBundle,
} from "../questions/ask-user-question-schema";
export type {
  HydrateEvent,
  HydrateMessage,
  HydrateMessageImage,
} from "./hydrate";

export type WirePromptImage = {
  data: string;
  mimeType: string;
};

export type ActiveProjectInfo = {
  id: string;
  name: string;
  path: string;
  displayName: string;
};

export type RecentProjectInfo = {
  path: string;
  displayName: string;
  lastOpenedAt: string;
};

export type SidecarQuestion = AskUserQuestionBundle[number];
export type SidecarQuestionOption = SidecarQuestion["options"][number];

export type PendingQuestion = {
  toolCallId: string;
  questions: AskUserQuestionBundle;
};

export type QuestionAnswer = AskUserQuestionAnswer;

export type CreatingTarget = "brief" | "prd" | "issues" | "plan" | "tasks";

export type McpAuthStatus = "started" | "authenticated" | "failed";

export type McpAuthStatusEvent = {
  type: "mcp_auth_status";
  server: string;
  status: McpAuthStatus;
  message: string;
};

export type SidecarOutMsg =
  | HydrateEvent
  | { type: "active_project"; project: ActiveProjectInfo }
  | { type: "ready" }
  | { type: "recents"; entries: RecentProjectInfo[] }
  | { type: "text_delta"; delta: string }
  | { type: "text_done" }
  | {
      type: "ask_user_question";
      toolCallId: string;
      questions: AskUserQuestionBundle;
    }
  | { type: "creating_started"; target: CreatingTarget; message: string }
  | McpAuthStatusEvent
  | { type: "agent_end" }
  | { type: "error"; message: string; recoverable?: boolean };

export type SidecarInMsg =
  | {
      type: "init";
      personaPath?: string;
      skillsPath?: string;
      skipAutoOpen?: boolean;
    }
  | { type: "prompt"; text: string; images?: WirePromptImage[] }
  | {
      type: "answer_question";
      toolCallId: string;
      cancelled: boolean;
      answers: AskUserQuestionAnswer[];
    }
  | { type: "new_project" }
  | { type: "open_project"; path: string; locateProjectRoot?: boolean }
  | { type: "list_recents" }
  | { type: "reload_mcp_config" }
  | { type: "authenticate_mcp_server"; server: string }
  | { type: "set_api_key"; provider: "anthropic"; apiKey: string };
