import { expect, test } from "bun:test";
import { AskUserQuestionToolParamsSchema } from "../../questions/ask-user-question-schema";

const validQuestion = {
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

test("ask_user_question schema accepts a valid grouped bundle with multi-select metadata", () => {
  const parsed = AskUserQuestionToolParamsSchema.parse({
    questions: [
      validQuestion,
      {
        header: "Scope",
        question: "What should the first slice include?",
        multiSelect: true,
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
  });

  expect(parsed.questions).toHaveLength(2);
  expect(parsed.questions[0].options[0].label).toBe("Team leads");
  expect(parsed.questions[1].multiSelect).toBe(true);
});

test("ask_user_question schema enforces 1-4 questions and 2-4 options", () => {
  expect(() =>
    AskUserQuestionToolParamsSchema.parse({ questions: [] }),
  ).toThrow();
  expect(() =>
    AskUserQuestionToolParamsSchema.parse({
      questions: Array.from({ length: 5 }, () => validQuestion),
    }),
  ).toThrow();
  expect(() =>
    AskUserQuestionToolParamsSchema.parse({
      questions: [
        {
          ...validQuestion,
          options: [validQuestion.options[0]],
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    AskUserQuestionToolParamsSchema.parse({
      questions: [
        {
          ...validQuestion,
          options: Array.from({ length: 5 }, (_, index) => ({
            label: `Option ${index + 1}`,
            description: "A concrete choice.",
          })),
        },
      ],
    }),
  ).toThrow();
});
