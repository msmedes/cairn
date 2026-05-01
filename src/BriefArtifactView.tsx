import type { BriefArtifactData } from "./briefArtifact";

type BriefArtifactViewProps = {
  data: BriefArtifactData;
};

export function BriefArtifactView({ data }: BriefArtifactViewProps) {
  return (
    <article className="brief-artifact" aria-labelledby="brief-artifact-title">
      <header className="brief-artifact-header">
        <p className="panel-kicker">Project Brief</p>
        <h2 id="brief-artifact-title">{data.title}</h2>
        <p>{data.summary}</p>
      </header>

      <dl className="brief-artifact-facts">
        <div>
          <dt>For</dt>
          <dd>{data.audience}</dd>
        </div>
        <div>
          <dt>Done feels like</dt>
          <dd>{data.success}</dd>
        </div>
      </dl>

      <div className="brief-artifact-sections">
        {data.sections.map((section) => (
          <section className="brief-artifact-section" key={section.heading}>
            <h3>{section.heading}</h3>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
