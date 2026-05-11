import type { BriefArtifactData } from "./briefArtifact";

type BriefArtifactViewProps = {
  data: BriefArtifactData;
};

const panelKickerClass =
  "panel-kicker mb-2 mt-0 text-[0.78rem] font-bold uppercase tracking-[0.16em] text-kanagawa-text-soft";

const artifactClass =
  "brief-artifact grid min-h-full gap-3.5 bg-[linear-gradient(135deg,rgba(126,156,216,0.1),transparent_34%),linear-gradient(180deg,rgba(31,31,40,0.98),rgba(22,22,29,0.98))] p-[30px] text-kanagawa-text max-[640px]:p-[22px]";

const artifactHeaderClass =
  "brief-artifact-header max-w-[46rem] border-b border-[var(--line)] pb-6";

const artifactTitleClass =
  "mt-2 mb-0 text-kanagawa-text text-[clamp(2rem,1.6rem+1.1vw,3rem)] leading-[1.02]";

const artifactSummaryClass =
  "mt-3.5 mb-0 max-w-[58ch] text-[1.05rem] leading-[1.6] text-kanagawa-text-soft";

const factsClass =
  "brief-artifact-facts mt-[22px] mb-0 grid grid-cols-2 gap-3.5 max-[640px]:grid-cols-1";

const factCardClass =
  "rounded-card border border-[var(--line)] bg-[rgba(42,42,55,0.7)] p-4";

const factLabelClass =
  "mb-2 mt-0 text-[0.74rem] font-extrabold uppercase tracking-0 text-kanagawa-text-muted";

const factValueClass = "m-0 leading-[1.5] text-kanagawa-text";

const sectionsClass = "brief-artifact-sections mt-[18px] grid gap-3.5";

const sectionClass =
  "brief-artifact-section rounded-card border border-[var(--line)] bg-[rgba(42,42,55,0.7)] p-[18px]";

const sectionTitleClass = "m-0 text-base leading-tight";

const sectionBodyClass = "mt-2.5 mb-0 leading-[1.6] text-kanagawa-text-soft";

export function BriefArtifactView({ data }: BriefArtifactViewProps) {
  return (
    <article className={artifactClass} aria-labelledby="brief-artifact-title">
      <header className={artifactHeaderClass}>
        <p className={panelKickerClass}>Project Brief</p>
        <h2 className={artifactTitleClass} id="brief-artifact-title">
          {data.title}
        </h2>
        <p className={artifactSummaryClass}>{data.summary}</p>
      </header>

      <dl className={factsClass}>
        <div className={factCardClass}>
          <dt className={factLabelClass}>For</dt>
          <dd className={factValueClass}>{data.audience}</dd>
        </div>
        <div className={factCardClass}>
          <dt className={factLabelClass}>Done feels like</dt>
          <dd className={factValueClass}>{data.success}</dd>
        </div>
      </dl>

      <div className={sectionsClass}>
        {data.sections.map((section) => (
          <section className={sectionClass} key={section.heading}>
            <h3 className={sectionTitleClass}>{section.heading}</h3>
            <p className={sectionBodyClass}>{section.body}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
