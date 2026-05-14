import type { PlanArtifactData } from "../planArtifact";

type PlanArtifactViewProps = {
  data: PlanArtifactData;
};

const panelKickerClass =
  "panel-kicker mb-1.5 mt-0 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

const artifactClass =
  "plan-artifact grid min-h-full gap-3.5 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--success)_12%,transparent),transparent_34%),linear-gradient(180deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--background)_98%,transparent))] p-6 text-foreground max-[640px]:p-[18px]";

const artifactHeaderClass =
  "plan-artifact-header max-w-[46rem] border-b border-[var(--border)] pb-4";

const artifactTitleClass =
  "m-0 text-foreground text-[1.5rem] font-semibold leading-tight tracking-[-0.01em]";

const artifactSummaryClass =
  "mt-2 mb-0 max-w-[58ch] text-sm leading-[1.55] text-muted-foreground";

const sectionClass =
  "plan-artifact-section max-w-[58rem] rounded-sm border border-border-strong bg-card p-[18px]";

const sectionTitleClass = "m-0 text-base leading-tight";

const sectionBodyClass = "mt-2.5 mb-0 leading-[1.6] text-muted-foreground";

const listClass = "mt-3 mb-0 pl-[1.35rem] text-muted-foreground";

const listItemClass = "mt-2 first:mt-0";

export function PlanArtifactView({ data }: PlanArtifactViewProps) {
  return (
    <article className={artifactClass} aria-labelledby="plan-artifact-title">
      <header className={artifactHeaderClass}>
        <p className={panelKickerClass}>Plan</p>
        <h2 className={artifactTitleClass} id="plan-artifact-title">
          {data.title}
        </h2>
        <p className={artifactSummaryClass}>{data.summary}</p>
      </header>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>From your brief</h3>
        <p className={sectionBodyClass}>{data.fromBrief}</p>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>
          What you'll have when this is done
        </h3>
        <ul className={listClass}>
          {data.outcomes.map((outcome) => (
            <li className={listItemClass} key={outcome}>
              {outcome}
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>The pieces I'll work through</h3>
        <ol className={listClass}>
          {data.pieces.map((piece) => (
            <li className={listItemClass} key={piece}>
              {piece}
            </li>
          ))}
        </ol>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>Not yet</h3>
        <ul className={listClass}>
          {data.notYet.map((item) => (
            <li className={listItemClass} key={item}>
              {item}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
