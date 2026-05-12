import { z } from "zod";

// Adapted from @juicesharp/rpiv-ask-user-question (MIT). Cairn keeps the
// schema-only pieces for a React-rendered single-select tracer surface.
const optionSchema = z.object({
  label: z.string().min(1).describe("Short label for this option."),
  description: z
    .string()
    .min(1)
    .describe("One sentence explaining the trade-off or implication."),
});

const questionSchema = z.object({
  header: z
    .string()
    .min(1)
    .describe("Short tab label for this question, such as Audience or Scope."),
  question: z.string().min(1).describe("The decision the user should make."),
  options: z
    .array(optionSchema)
    .min(2)
    .max(4)
    .describe("The concrete choices the user can pick from."),
});

export const AskUserQuestionToolParamsSchema = z.object({
  questions: z
    .array(questionSchema)
    .min(1)
    .max(4)
    .describe("One to four related single-select questions."),
});

export type AskUserQuestionParams = z.infer<
  typeof AskUserQuestionToolParamsSchema
>;

export type AskUserQuestionBundle = AskUserQuestionParams["questions"];

export type AskUserQuestionValidationError =
  | "duplicate_question"
  | "duplicate_option_label"
  | "reserved_label";

export type AskUserQuestionValidationResult =
  | { ok: true }
  | {
      ok: false;
      error: AskUserQuestionValidationError;
      message: string;
    };

const RESERVED_OPTION_LABELS = ["Other", "Type something."] as const;

function comparableText(value: string): string {
  return value.trim().toLowerCase();
}

export function validateQuestionnaire(
  params: AskUserQuestionParams,
): AskUserQuestionValidationResult {
  const seenQuestions = new Set<string>();

  for (const question of params.questions) {
    const questionText = comparableText(question.question);
    if (seenQuestions.has(questionText)) {
      return {
        ok: false,
        error: "duplicate_question",
        message:
          "Question text must be unique within one ask_user_question bundle.",
      };
    }
    seenQuestions.add(questionText);
  }

  const reservedLabels = new Set(RESERVED_OPTION_LABELS.map(comparableText));

  for (const question of params.questions) {
    const seenOptionLabels = new Set<string>();
    for (const option of question.options) {
      const optionLabel = comparableText(option.label);
      if (reservedLabels.has(optionLabel)) {
        return {
          ok: false,
          error: "reserved_label",
          message:
            'Option labels must not use reserved UI sentinel labels like "Other" or "Type something.".',
        };
      }
      if (seenOptionLabels.has(optionLabel)) {
        return {
          ok: false,
          error: "duplicate_option_label",
          message:
            "Option labels must be unique within each ask_user_question question.",
        };
      }
      seenOptionLabels.add(optionLabel);
    }
  }

  return { ok: true };
}

export type AskUserQuestionAnswer = {
  questionIndex: number;
  header: string;
  question: string;
  kind: "option";
  option: {
    label: string;
    description: string;
  };
};

export type AskUserQuestionResult =
  | {
      cancelled: false;
      answers: AskUserQuestionAnswer[];
    }
  | {
      cancelled: true;
      answers: [];
    };
