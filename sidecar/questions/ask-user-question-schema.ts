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
