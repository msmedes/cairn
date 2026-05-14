import type { BriefArtifactData } from "../briefArtifact";

type BriefArtifactViewProps = {
  data: BriefArtifactData;
};

const panelKickerClass =
  "panel-kicker mb-1.5 mt-0 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

const artifactClass =
  "brief-artifact grid min-h-full gap-3.5 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_34%),linear-gradient(180deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--background)_98%,transparent))] p-6 text-foreground max-[640px]:p-[18px]";

const artifactHeaderClass =
  "brief-artifact-header max-w-[46rem] border-b border-[var(--border)] pb-4";

const artifactTitleClass =
  "m-0 text-foreground text-[1.5rem] font-semibold leading-tight tracking-[-0.01em]";

const artifactSummaryClass =
  "mt-2 mb-0 max-w-[58ch] text-sm leading-[1.55] text-muted-foreground";

const factsClass =
  "brief-artifact-facts mt-[22px] mb-0 grid grid-cols-2 gap-3.5 max-[640px]:grid-cols-1";

const factCardClass = "rounded-sm border border-border-strong bg-card p-4";

const factLabelClass =
  "mb-2 mt-0 text-[0.74rem] font-extrabold uppercase tracking-0 text-secondary-foreground";

const factValueClass = "m-0 leading-[1.5] text-foreground";

const sectionsClass = "brief-artifact-sections mt-[18px] grid gap-3.5";

const sectionClass =
  "brief-artifact-section rounded-sm border border-border-strong bg-card p-[18px]";

const sectionTitleClass = "m-0 text-base leading-tight";

const sectionBodyClass = "mt-2.5 mb-0 leading-[1.6] text-muted-foreground";

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
