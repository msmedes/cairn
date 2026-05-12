import { expect, test } from "bun:test";
import {
  type AskUserQuestionParams,
  AskUserQuestionToolParamsSchema,
  validateQuestionnaire,
} from "../../../questions/ask-user-question-schema";
import { createCairnTools } from "../../../tools/cairn-tools";

const baseQuestion = {
  header: "Audience",
  question: "Who should this first version serve?",
  options: [
    {
      label: "Team leads",
      description: "People who need lightweight training checks.",
    },
    {
      label: "Learners",
      description: "People taking the quizzes themselves.",
    },
  ],
};

function validBundle(
  overrides: Partial<AskUserQuestionParams> = {},
): AskUserQuestionParams {
  return {
    questions: [baseQuestion],
    ...overrides,
  };
}

test("validateQuestionnaire accepts single and multi-question bundles", () => {
  expect(validateQuestionnaire(validBundle())).toEqual({ ok: true });
  expect(
    validateQuestionnaire(
      validBundle({
        questions: [
          baseQuestion,
          {
            header: "Scope",
            question: "What should the first slice include?",
            options: [
              {
                label: "One video",
                description: "Keep the first version focused on one upload.",
              },
              {
                label: "Many videos",
                description: "Start with batch setup from the beginning.",
              },
            ],
          },
        ],
      }),
    ),
  ).toEqual({ ok: true });
});

test("validateQuestionnaire rejects duplicate question text case-insensitively after trimming", () => {
  const result = validateQuestionnaire(
    validBundle({
      questions: [
        baseQuestion,
        {
          ...baseQuestion,
          header: "Audience again",
          question: "  who should this first version serve?  ",
        },
      ],
    }),
  );

  expect(result).toMatchObject({
    ok: false,
    error: "duplicate_question",
  });
});

test("validateQuestionnaire rejects duplicate option labels within one question case-insensitively after trimming", () => {
  const result = validateQuestionnaire(
    validBundle({
      questions: [
        {
          ...baseQuestion,
          options: [
            baseQuestion.options[0],
            {
              label: "  team leads  ",
              description: "The same choice with different casing.",
            },
          ],
        },
      ],
    }),
  );

  expect(result).toMatchObject({
    ok: false,
    error: "duplicate_option_label",
  });
});

test("validateQuestionnaire allows repeated option labels across different questions", () => {
  expect(
    validateQuestionnaire(
      validBundle({
        questions: [
          {
            header: "Include analytics",
            question: "Should analytics be in this first slice?",
            options: [
              {
                label: "Yes",
                description: "Include the simplest useful view.",
              },
              { label: "No", description: "Keep the first slice narrower." },
            ],
          },
          {
            header: "Include sharing",
            question: "Should sharing be in this first slice?",
            options: [
              { label: "Yes", description: "Add a shareable result early." },
              { label: "No", description: "Keep sharing out for now." },
            ],
          },
        ],
      }),
    ),
  ).toEqual({ ok: true });
});

test.each([
  "Other",
  "other",
  "  OTHER  ",
  "Type something.",
  "type something.",
  "Type your own answer",
  "type your own answer",
])("validateQuestionnaire rejects reserved option label %s", (label) => {
  const result = validateQuestionnaire(
    validBundle({
      questions: [
        {
          ...baseQuestion,
          options: [
            { label, description: "Collides with a React sentinel." },
            baseQuestion.options[1],
          ],
        },
      ],
    }),
  );

  expect(result).toMatchObject({
    ok: false,
    error: "reserved_label",
  });
});

test("ask_user_question execute returns validation failures as normal tool results", async () => {
  const askUserQuestion = createCairnTools({
    getActiveProject: () => null,
    renameProject: () => {
      throw new Error("should not rename while asking a question");
    },
    onRenameSuccess: () => {
      throw new Error("should not retarget while asking a question");
    },
    onProjectUpdate: () => {
      throw new Error(
        "should not emit project updates while asking a question",
      );
    },
    onCreatingStart: () => {
      throw new Error("should not emit creating state while asking a question");
    },
    askUserQuestion: async () => {
      throw new Error("should not park invalid question bundles");
    },
  }).find((tool) => tool.name === "ask_user_question");

  if (!askUserQuestion) {
    throw new Error("ask_user_question tool was not registered");
  }

  const params = AskUserQuestionToolParamsSchema.parse(
    validBundle({
      questions: [
        {
          ...baseQuestion,
          options: [
            { label: "Other", description: "Collides with a React sentinel." },
            baseQuestion.options[1],
          ],
        },
      ],
    }),
  );
  const result = await askUserQuestion.execute(
    "tool-call-1",
    params,
    undefined,
    undefined,
    {} as never,
  );

  expect(result.details).toMatchObject({
    ok: false,
    error: "reserved_label",
  });
  expect(result.content).toEqual([
    { type: "text", text: JSON.stringify(result.details) },
  ]);
});
