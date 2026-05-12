import type { PlanArtifactData } from "../planArtifact";

type PlanArtifactViewProps = {
  data: PlanArtifactData;
};

const panelKickerClass =
  "panel-kicker mb-2 mt-0 text-[0.78rem] font-bold uppercase tracking-[0.16em] text-kanagawa-text-soft";

const artifactClass =
  "plan-artifact grid min-h-full gap-3.5 bg-[linear-gradient(135deg,rgba(152,187,108,0.12),transparent_34%),linear-gradient(180deg,rgba(31,31,40,0.98),rgba(22,22,29,0.98))] p-[30px] text-kanagawa-text max-[640px]:p-[22px]";

const artifactHeaderClass =
  "plan-artifact-header max-w-[46rem] border-b border-[var(--line)] pb-6";

const artifactTitleClass =
  "mt-2 mb-0 text-kanagawa-text text-[clamp(2rem,1.6rem+1.1vw,3rem)] leading-[1.02]";

const artifactSummaryClass =
  "mt-3.5 mb-0 max-w-[58ch] text-[1.05rem] leading-[1.6] text-kanagawa-text-soft";

const sectionClass =
  "plan-artifact-section max-w-[58rem] rounded-card border border-[var(--line)] bg-[rgba(42,42,55,0.7)] p-[18px]";

const sectionTitleClass = "m-0 text-base leading-tight";

const sectionBodyClass = "mt-2.5 mb-0 leading-[1.6] text-kanagawa-text-soft";

const listClass = "mt-3 mb-0 pl-[1.35rem] text-kanagawa-text-soft";

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
