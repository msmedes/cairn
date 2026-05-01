import type { PlanArtifactData } from "./planArtifact";

type PlanArtifactViewProps = {
  data: PlanArtifactData;
};

export function PlanArtifactView({ data }: PlanArtifactViewProps) {
  return (
    <article className="plan-artifact" aria-labelledby="plan-artifact-title">
      <header className="plan-artifact-header">
        <p className="panel-kicker">Plan</p>
        <h2 id="plan-artifact-title">{data.title}</h2>
        <p>{data.summary}</p>
      </header>

      <section className="plan-artifact-section">
        <h3>From your brief</h3>
        <p>{data.fromBrief}</p>
      </section>

      <section className="plan-artifact-section">
        <h3>What you'll have when this is done</h3>
        <ul>
          {data.outcomes.map((outcome) => (
            <li key={outcome}>{outcome}</li>
          ))}
        </ul>
      </section>

      <section className="plan-artifact-section">
        <h3>The pieces I'll work through</h3>
        <ol>
          {data.pieces.map((piece) => (
            <li key={piece}>{piece}</li>
          ))}
        </ol>
      </section>

      <section className="plan-artifact-section">
        <h3>Not yet</h3>
        <ul>
          {data.notYet.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
