import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { PendingQuestion } from "../hooks/useSidecarSession";
import { QuestionCard } from "./QuestionCard";

const bundle: PendingQuestion = {
  toolCallId: "tool-call-1",
  questions: [
    {
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
    },
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
};

const mixedBundle: PendingQuestion = {
  toolCallId: "tool-call-2",
  questions: [
    {
      header: "Priorities",
      question: "Which priorities matter most?",
      multiSelect: true,
      options: [
        {
          label: "Fast setup",
          description: "The first version should be quick to configure.",
        },
        {
          label: "Polished results",
          description: "The first version should feel finished to users.",
        },
        {
          label: "Team sharing",
          description: "The first version should support collaboration.",
        },
      ],
    },
    {
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
    },
  ],
};

describe("QuestionCard", () => {
  test("submits selected options from a multi-question bundle", () => {
    const onSubmitted = vi.fn();

    render(
      <QuestionCard
        pendingQuestion={bundle}
        isSubmitting={false}
        onSubmitted={onSubmitted}
        onSkipped={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: /Audience/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Team leads"));
    fireEvent.click(screen.getByRole("tab", { name: /Scope/ }));
    fireEvent.click(screen.getByLabelText("One video"));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmitted).toHaveBeenCalledWith([
      {
        questionIndex: 0,
        header: "Audience",
        question: "Who should this first version serve?",
        kind: "option",
        option: {
          label: "Team leads",
          description: "People who need lightweight training checks.",
        },
      },
      {
        questionIndex: 1,
        header: "Scope",
        question: "What should the first slice include?",
        kind: "option",
        option: {
          label: "One video",
          description: "Keep the first version focused on one upload.",
        },
      },
    ]);
  });

  test("submits mixed multi-select and single-select answers", () => {
    const onSubmitted = vi.fn();

    render(
      <QuestionCard
        pendingQuestion={mixedBundle}
        isSubmitting={false}
        onSubmitted={onSubmitted}
        onSkipped={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Fast setup" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Polished results" }));
    fireEvent.click(screen.getByRole("tab", { name: /Audience/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Learners" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmitted).toHaveBeenCalledWith([
      {
        questionIndex: 0,
        header: "Priorities",
        question: "Which priorities matter most?",
        kind: "multi",
        selected: ["Fast setup", "Polished results"],
      },
      {
        questionIndex: 1,
        header: "Audience",
        question: "Who should this first version serve?",
        kind: "option",
        option: {
          label: "Learners",
          description: "People taking the quizzes themselves.",
        },
      },
    ]);
  });

  test("skip resolves through the skip callback", () => {
    const onSkipped = vi.fn();

    render(
      <QuestionCard
        pendingQuestion={bundle}
        isSubmitting={false}
        onSubmitted={vi.fn()}
        onSkipped={onSkipped}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(onSkipped).toHaveBeenCalledOnce();
  });

  test("tab labels show which questions are answered", () => {
    render(
      <QuestionCard
        pendingQuestion={bundle}
        isSubmitting={false}
        onSubmitted={vi.fn()}
        onSkipped={vi.fn()}
      />,
    );

    const audienceTab = screen.getByRole("tab", { name: /Audience/ });
    expect(within(audienceTab).getByText("Needs answer")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Team leads"));

    expect(within(audienceTab).getByText("Answered")).toBeInTheDocument();
  });
});
