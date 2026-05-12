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

const cardClass =
  "question-card grid gap-4 px-7 pb-[22px] pt-3.5 max-[640px]:mx-3 max-[640px]:mb-3 max-[640px]:mt-0 max-[640px]:p-3";

const panelClass =
  "grid gap-4 rounded-md bg-kanagawa-surface-strong p-4 shadow-[inset_0_0_0_1px_rgba(220,215,186,0.1),0_14px_28px_rgba(0,0,0,0.18)]";

const tabsClass =
  "flex min-w-0 gap-2 overflow-x-auto border-b border-[rgba(220,215,186,0.08)] pb-2";

const tabClass =
  "grid min-w-[118px] gap-1 rounded-md border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-kanagawa-text-soft transition-[background,color,box-shadow] duration-150 enabled:cursor-pointer hover:bg-[rgba(220,215,186,0.06)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(126,156,216,0.26)]";

const activeTabClass = "bg-[rgba(126,156,216,0.13)] text-kanagawa-text";

const tabHeaderClass = "text-[0.82rem] font-semibold leading-tight";

const tabStatusClass =
  "text-[0.72rem] font-medium leading-tight text-kanagawa-text-soft";

const questionHeaderClass =
  "m-0 text-[0.78rem] font-semibold uppercase leading-none tracking-[0.08em] text-kanagawa-text-soft";

const questionTextClass =
  "m-0 text-[1.02rem] font-semibold leading-snug text-kanagawa-text";

const optionsClass = "m-0 grid list-none gap-2 p-0";

const optionClass =
  "grid cursor-pointer gap-1 rounded-md bg-[rgba(22,22,29,0.32)] px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(220,215,186,0.08)] transition-[background,box-shadow] duration-150 has-[:checked]:bg-[rgba(126,156,216,0.14)] has-[:checked]:shadow-[inset_0_0_0_1px_rgba(126,156,216,0.42)]";

const optionTopClass = "flex min-w-0 items-center gap-2";

const optionLabelClass = "font-semibold leading-tight text-kanagawa-text";

const optionDescriptionClass =
  "m-0 pl-6 text-[0.84rem] leading-snug text-kanagawa-text-soft";

const footerClass = "flex justify-end gap-2";

const skipButtonClass =
  "min-h-10 rounded-md border-0 bg-transparent px-4 font-[inherit] font-semibold text-kanagawa-text-soft shadow-[inset_0_0_0_1px_rgba(220,215,186,0.12)] transition-[background,color] duration-150 enabled:cursor-pointer hover:enabled:bg-[rgba(220,215,186,0.06)] focus-visible:enabled:outline-none focus-visible:enabled:shadow-[0_0_0_3px_rgba(126,156,216,0.26)]";

const submitButtonClass =
  "min-h-10 rounded-md border-0 bg-[rgba(42,42,55,0.7)] px-4 font-[inherit] font-semibold text-kanagawa-text-soft shadow-[inset_0_0_0_1px_rgba(220,215,186,0.06)] transition-[transform,box-shadow,opacity,background] duration-[120ms,180ms,180ms,180ms] enabled:cursor-pointer enabled:bg-[linear-gradient(180deg,#7e9cd8,#658594)] enabled:text-kanagawa-bg enabled:shadow-[0_1px_1px_rgba(255,255,255,0.12)_inset,0_10px_20px_rgba(101,133,148,0.22)] active:enabled:scale-[0.96] disabled:cursor-not-allowed disabled:[background:rgba(42,42,55,0.7)]";

export function QuestionCard({
  pendingQuestion,
  isSubmitting,
  onSubmitted,
  onSkipped,
}: QuestionCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<number, number>
  >({});
  const activeQuestion = pendingQuestion.questions[activeIndex];
  const allAnswered = pendingQuestion.questions.every(
    (_question, index) => selectedOptions[index] !== undefined,
  );

  function submit() {
    if (!allAnswered || isSubmitting) return;
    const answers = pendingQuestion.questions.map((question, questionIndex) => {
      const optionIndex = selectedOptions[questionIndex];
      const option = question.options[optionIndex];
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
              const answered = selectedOptions[index] !== undefined;
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
                    type="radio"
                    aria-label={option.label}
                    name={`question-${activeIndex}`}
                    checked={selectedOptions[activeIndex] === optionIndex}
                    disabled={isSubmitting}
                    onChange={() =>
                      setSelectedOptions((current) => ({
                        ...current,
                        [activeIndex]: optionIndex,
                      }))
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
          <button
            type="submit"
            className={submitButtonClass}
            disabled={!allAnswered || isSubmitting}
          >
            Submit
          </button>
        </div>
      </div>
    </form>
  );
}
