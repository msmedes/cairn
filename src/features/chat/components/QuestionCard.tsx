import { useState } from "react";
import { cx } from "../../../lib/cx";
import type {
  PendingQuestion,
  QuestionAnswer,
} from "../hooks/useSidecarSession";

type QuestionCardProps = {
  pendingQuestion: PendingQuestion;
  isSubmitting: boolean;
  onSubmitted: (answers: QuestionAnswer[]) => void;
  onSkipped: () => void;
};

type SelectedAnswer =
  | { kind: "option"; optionIndex: number }
  | { kind: "custom"; answer: string }
  | { kind: "multi"; optionIndexes: number[] };

const CUSTOM_ANSWER_LABEL = "Type your own answer";

const cardClass =
  "question-card grid gap-4 px-7 pb-[22px] pt-3.5 max-[640px]:mx-3 max-[640px]:mb-3 max-[640px]:mt-0 max-[640px]:p-3";

const panelClass =
  "grid gap-4 rounded-md bg-input p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent),0_14px_28px_rgb(0_0_0/0.18)]";

const tabsClass =
  "flex min-w-0 gap-2 overflow-x-auto border-b border-[color-mix(in_srgb,var(--foreground)_8%,transparent)] pb-2";

const tabClass =
  "grid min-w-[118px] gap-1 rounded-t-md border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-muted-foreground transition-[background,color,box-shadow] duration-150 enabled:cursor-pointer hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_26%,transparent)]";

const activeTabClass =
  "text-foreground shadow-[inset_0_-2px_0_0_color-mix(in_srgb,var(--primary)_90%,transparent)]";

const tabHeaderClass = "text-[0.82rem] font-semibold leading-tight";

const tabStatusClass =
  "text-[0.72rem] font-medium leading-tight text-muted-foreground";

const questionHeaderClass =
  "m-0 text-[0.78rem] font-semibold uppercase leading-none tracking-[0.08em] text-muted-foreground";

const questionTextClass =
  "m-0 text-[1.02rem] font-semibold leading-snug text-foreground";

const optionsClass = "m-0 grid list-none gap-2 p-0";

const optionClass =
  "grid cursor-pointer gap-1 rounded-md bg-[color-mix(in_srgb,var(--background)_32%,transparent)] px-3.5 py-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] transition-[background,box-shadow] duration-150 has-[:checked]:bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] has-[:checked]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_42%,transparent)]";

const optionTopClass = "flex min-w-0 items-center gap-2";

const optionLabelClass = "font-semibold leading-tight text-foreground";

const optionDescriptionClass =
  "m-0 pl-6 text-[0.84rem] leading-snug text-muted-foreground";

const customAnswerInputClass =
  "ml-6 min-h-10 rounded-md border-0 bg-[color-mix(in_srgb,var(--background)_50%,transparent)] px-3 font-[inherit] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_14%,transparent)] outline-none transition-shadow duration-150 placeholder:text-muted-foreground focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_50%,transparent),0_0_0_3px_color-mix(in_srgb,var(--primary)_18%,transparent)] disabled:cursor-not-allowed disabled:opacity-70";

const footerClass = "flex items-center justify-between gap-2";

const footerRightClass = "flex items-center gap-2";

const progressClass =
  "text-[0.78rem] font-medium leading-tight text-muted-foreground";

const skipButtonClass =
  "min-h-10 rounded-md border-0 bg-transparent px-4 font-[inherit] font-semibold text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)] transition-[background,color] duration-150 enabled:cursor-pointer hover:enabled:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] focus-visible:enabled:outline-none focus-visible:enabled:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_26%,transparent)]";

const navButtonClass =
  "min-h-10 rounded-md border-0 bg-transparent px-3 font-[inherit] font-semibold text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)] transition-[background,color,opacity] duration-150 enabled:cursor-pointer hover:enabled:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] focus-visible:enabled:outline-none focus-visible:enabled:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_26%,transparent)] disabled:cursor-not-allowed disabled:opacity-40";

const submitButtonClass =
  "min-h-10 rounded-md border-0 bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] px-4 font-[inherit] font-semibold text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)] transition-[transform,box-shadow,opacity,background] duration-[120ms,180ms,180ms,180ms] enabled:cursor-pointer enabled:bg-[linear-gradient(180deg,var(--primary),color-mix(in_oklab,var(--primary),black_18%))] enabled:text-background enabled:shadow-[0_1px_1px_rgb(255_255_255/0.12)_inset,0_10px_20px_color-mix(in_srgb,color-mix(in_oklab,var(--primary),black_18%)_22%,transparent)] active:enabled:scale-[0.96] disabled:cursor-not-allowed disabled:[background:color-mix(in_srgb,var(--muted)_70%,transparent)]";

export function QuestionCard({
  pendingQuestion,
  isSubmitting,
  onSubmitted,
  onSkipped,
}: QuestionCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<number, SelectedAnswer>
  >({});
  const activeQuestion = pendingQuestion.questions[activeIndex];
  const activeSelection = selectedAnswers[activeIndex];
  const allAnswered = pendingQuestion.questions.every((question, index) => {
    const selection = selectedAnswers[index];
    if (!selection) return false;
    if (question.multiSelect) {
      return selection.kind === "multi" && selection.optionIndexes.length > 0;
    }
    return (
      selection.kind === "option" ||
      (selection.kind === "custom" && selection.answer.trim().length > 0)
    );
  });

  function isOptionChecked(optionIndex: number) {
    if (!activeSelection) return false;
    if (activeQuestion.multiSelect) {
      return (
        activeSelection.kind === "multi" &&
        activeSelection.optionIndexes.includes(optionIndex)
      );
    }
    return (
      activeSelection.kind === "option" &&
      activeSelection.optionIndex === optionIndex
    );
  }

  function isCustomAnswerChecked() {
    return activeSelection?.kind === "custom";
  }

  function chooseOption(optionIndex: number) {
    setSelectedAnswers((current) => ({
      ...current,
      [activeIndex]: { kind: "option", optionIndex },
    }));
    if (activeIndex < pendingQuestion.questions.length - 1) {
      setActiveIndex(activeIndex + 1);
    }
  }

  function chooseCustomAnswer() {
    setSelectedAnswers((current) => ({
      ...current,
      [activeIndex]:
        current[activeIndex]?.kind === "custom"
          ? current[activeIndex]
          : { kind: "custom", answer: "" },
    }));
  }

  function updateCustomAnswer(answer: string) {
    setSelectedAnswers((current) => ({
      ...current,
      [activeIndex]: { kind: "custom", answer },
    }));
  }

  function toggleMultiOption(optionIndex: number) {
    setSelectedAnswers((current) => {
      const currentSelection = current[activeIndex];
      const optionIndexes =
        currentSelection?.kind === "multi"
          ? currentSelection.optionIndexes
          : [];
      const nextOptionIndexes = optionIndexes.includes(optionIndex)
        ? optionIndexes.filter((index) => index !== optionIndex)
        : [...optionIndexes, optionIndex].sort((left, right) => left - right);

      return {
        ...current,
        [activeIndex]: { kind: "multi", optionIndexes: nextOptionIndexes },
      };
    });
  }

  function submit() {
    if (!allAnswered || isSubmitting) return;
    const answers = pendingQuestion.questions.map((question, questionIndex) => {
      const selection = selectedAnswers[questionIndex];
      if (selection.kind === "multi") {
        return {
          questionIndex,
          header: question.header,
          question: question.question,
          kind: "multi" as const,
          selected: selection.optionIndexes.map(
            (optionIndex) => question.options[optionIndex].label,
          ),
        };
      }

      if (selection.kind === "custom") {
        return {
          questionIndex,
          header: question.header,
          question: question.question,
          kind: "custom" as const,
          answer: selection.answer.trim(),
        };
      }

      const option = question.options[selection.optionIndex];
      return {
        questionIndex,
        header: question.header,
        question: question.question,
        kind: "option" as const,
        option,
      };
    });
    onSubmitted(answers);
  }

  return (
    <form
      className={cardClass}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={panelClass}>
        {pendingQuestion.questions.length > 1 && (
          <div className={tabsClass} role="tablist" aria-label="Questions">
            {pendingQuestion.questions.map((question, index) => {
              const selection = selectedAnswers[index];
              const answered =
                selection?.kind === "option" ||
                (selection?.kind === "custom" &&
                  selection.answer.trim().length > 0) ||
                (selection?.kind === "multi" &&
                  selection.optionIndexes.length > 0);
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeIndex === index}
                  className={cx(
                    tabClass,
                    activeIndex === index && activeTabClass,
                  )}
                  key={question.header}
                  disabled={isSubmitting}
                  onClick={() => setActiveIndex(index)}
                >
                  <span className={tabHeaderClass}>{question.header}</span>
                  <span className={tabStatusClass}>
                    {answered ? "Answered" : "Needs answer"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <section aria-labelledby="question-card-title">
          <p className={questionHeaderClass}>{activeQuestion.header}</p>
          <h2 className={questionTextClass} id="question-card-title">
            {activeQuestion.question}
          </h2>
        </section>
        <ul className={optionsClass}>
          {activeQuestion.options.map((option, optionIndex) => (
            <li key={option.label}>
              <label className={optionClass}>
                <span className={optionTopClass}>
                  <input
                    type={activeQuestion.multiSelect ? "checkbox" : "radio"}
                    aria-label={option.label}
                    name={`question-${activeIndex}`}
                    checked={isOptionChecked(optionIndex)}
                    disabled={isSubmitting}
                    onChange={() =>
                      activeQuestion.multiSelect
                        ? toggleMultiOption(optionIndex)
                        : chooseOption(optionIndex)
                    }
                  />
                  <span className={optionLabelClass}>{option.label}</span>
                </span>
                <span className={optionDescriptionClass}>
                  {option.description}
                </span>
              </label>
            </li>
          ))}
          {!activeQuestion.multiSelect && (
            <li>
              <label className={optionClass}>
                <span className={optionTopClass}>
                  <input
                    type="radio"
                    aria-label={CUSTOM_ANSWER_LABEL}
                    name={`question-${activeIndex}`}
                    checked={isCustomAnswerChecked()}
                    disabled={isSubmitting}
                    onChange={chooseCustomAnswer}
                  />
                  <span className={optionLabelClass}>
                    {CUSTOM_ANSWER_LABEL}
                  </span>
                </span>
                {activeSelection?.kind === "custom" && (
                  <input
                    type="text"
                    aria-label={CUSTOM_ANSWER_LABEL}
                    className={customAnswerInputClass}
                    value={activeSelection.answer}
                    disabled={isSubmitting}
                    onChange={(event) =>
                      updateCustomAnswer(event.currentTarget.value)
                    }
                  />
                )}
              </label>
            </li>
          )}
        </ul>
        <div className={footerClass}>
          <button
            type="button"
            className={skipButtonClass}
            disabled={isSubmitting}
            onClick={onSkipped}
          >
            Skip
          </button>
          <div className={footerRightClass}>
            {pendingQuestion.questions.length > 1 && (
              <>
                <span className={progressClass} aria-live="polite">
                  Question {activeIndex + 1} of{" "}
                  {pendingQuestion.questions.length}
                </span>
                <button
                  type="button"
                  className={navButtonClass}
                  disabled={isSubmitting || activeIndex === 0}
                  onClick={() => setActiveIndex(activeIndex - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={navButtonClass}
                  disabled={
                    isSubmitting ||
                    activeIndex === pendingQuestion.questions.length - 1
                  }
                  onClick={() => setActiveIndex(activeIndex + 1)}
                >
                  Next
                </button>
              </>
            )}
            <button
              type="submit"
              className={submitButtonClass}
              disabled={!allAnswered || isSubmitting}
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
