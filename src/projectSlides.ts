type DraftSection = {
  title: string;
  blocks: string[];
  plain: string[];
};

type FinalSection = {
  id: string;
  title: string;
  summary: string;
  body: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeInlineText(text: string): string {
  return decodeEntities(text)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .trim();
}

function createDraftSection(title: string): DraftSection {
  return { title, blocks: [], plain: [] };
}

function finalizeSections(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  let docTitle = "Project plan";
  let intro = createDraftSection("Overview");
  const drafts: DraftSection[] = [];
  let currentSection: DraftSection | null = null;
  let paragraph: string[] = [];
  let listItems: string[] = [];

  function targetSection() {
    return currentSection ?? intro;
  }

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    const section = targetSection();
    section.blocks.push(`<p>${escapeHtml(text)}</p>`);
    section.plain.push(text);
    paragraph = [];
  }

  function flushList() {
    if (listItems.length === 0) return;
    const section = targetSection();
    section.blocks.push(
      `<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    );
    section.plain.push(...listItems);
    listItems = [];
  }

  function flushAll() {
    flushParagraph();
    flushList();
  }

  for (const rawLine of lines) {
    const line = normalizeInlineText(rawLine.trim());

    if (!line) {
      flushAll();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const level = Math.min(headingMatch[1].length, 6);
      const headingText = normalizeInlineText(headingMatch[2]);

      if (level === 1) {
        docTitle = headingText;
        continue;
      }

      if (level === 2) {
        currentSection = createDraftSection(headingText);
        drafts.push(currentSection);
        continue;
      }

      const section = targetSection();
      section.blocks.push(`<h${Math.min(level, 4)}>${escapeHtml(headingText)}</h${Math.min(level, 4)}>`);
      section.plain.push(headingText);
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      listItems.push(normalizeInlineText(unorderedMatch[1]));
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      listItems.push(normalizeInlineText(orderedMatch[1]));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushAll();

  const sections: FinalSection[] = [];
  const usedIds = new Set<string>();

  function pushSection(title: string, blocks: string[], plain: string[]) {
    const body = blocks.join("");
    if (!body.trim()) return;

    let id = slugify(title);
    let counter = 2;
    while (usedIds.has(id)) {
      id = `${slugify(title)}-${counter}`;
      counter += 1;
    }
    usedIds.add(id);

    const summarySource = plain.find((item) => item.trim().length > 0) ?? title;
    const summary = summarySource.slice(0, 110);
    sections.push({ id, title, summary, body });
  }

  if (intro.blocks.length > 0) {
    pushSection(intro.title, intro.blocks, intro.plain);
  }

  for (const draft of drafts) {
    pushSection(draft.title, draft.blocks, draft.plain);
  }

  if (sections.length === 0) {
    pushSection("Overview", [`<p>${escapeHtml(markdown.trim() || "Your project will show up here as we talk.")}</p>`], [
      markdown.trim() || "Your project will show up here as we talk.",
    ]);
  }

  const introSummary =
    sections[0] ? stripHtml(sections[0].body).slice(0, 180) : "Your project will show up here as we talk.";

  return { docTitle, introSummary, sections };
}

export function buildSlidesDocument(markdown: string): string {
  const { docTitle, introSummary, sections } = finalizeSections(markdown);

  const navMarkup = sections
    .map(
      (section, index) => `
        <button class="nav-item" type="button" data-target="${section.id}">
          <span class="nav-step">${String(index + 1).padStart(2, "0")}</span>
          <span class="nav-copy">
            <strong>${escapeHtml(section.title)}</strong>
            <small>${escapeHtml(section.summary)}</small>
          </span>
        </button>
      `,
    )
    .join("");

  const panelMarkup = sections
    .map(
      (section, index) => `
        <article class="detail-panel" id="${section.id}" data-panel="${section.id}" ${
          index === 0 ? 'data-active="true"' : ""
        }>
          <div class="detail-meta">
            <span class="detail-chip">Section ${String(index + 1).padStart(2, "0")}</span>
          </div>
          <div class="detail-body"><h2>${escapeHtml(section.title)}</h2>${section.body}</div>
        </article>
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(docTitle)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #16161d;
        --bg-soft: #1f1f28;
        --bg-elevated: #223249;
        --panel: rgba(31, 31, 40, 0.92);
        --panel-strong: rgba(42, 42, 55, 0.94);
        --line: rgba(220, 215, 186, 0.09);
        --text: #dcd7ba;
        --text-soft: #c8c093;
        --text-muted: #938aa9;
        --blue: #7e9cd8;
        --aqua: #7fb4ca;
        --green: #98bb6c;
        --gold: #dca561;
        --orange: #ffa066;
        --red: #c34043;
        --radius-shell: 14px;
        --radius-card: 8px;
        --radius-inner: 6px;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: transparent;
        color: var(--text);
        font-family: "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }

      body {
        padding: 0;
      }

      .site {
        display: grid;
        grid-template-columns: minmax(220px, 0.72fr) minmax(0, 1.58fr);
        gap: 14px;
        height: 100%;
      }

      .sidebar,
      .detail-shell {
        min-width: 0;
        min-height: 0;
        border-radius: var(--radius-shell);
        background: var(--panel);
        border: 1px solid var(--line);
        box-shadow:
          0 2px 10px rgba(0, 0, 0, 0.2),
          0 24px 54px rgba(0, 0, 0, 0.26);
        backdrop-filter: blur(14px);
      }

      .sidebar {
        display: flex;
        flex-direction: column;
        padding: 22px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        min-height: 36px;
        padding: 0 12px;
        border-radius: 999px;
        background: rgba(126, 156, 216, 0.16);
        color: var(--blue);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-variant-numeric: tabular-nums;
      }

      .sidebar h1 {
        margin: 16px 0 10px;
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        font-size: clamp(26px, 3.2vw, 36px);
        font-weight: 600;
        line-height: 1.02;
        letter-spacing: -0.03em;
        text-wrap: balance;
      }

      .sidebar p {
        margin: 0;
        color: var(--text-muted);
        font-size: 14px;
        line-height: 1.65;
        text-wrap: pretty;
      }

      .nav {
        display: grid;
        gap: 4px;
        margin-top: 20px;
        overflow-y: auto;
        padding-right: 2px;
      }

      .nav-item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: start;
        gap: 12px;
        width: 100%;
        padding: 12px 14px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
        box-shadow: inset 0 0 0 1px transparent;
        transition:
          transform 160ms cubic-bezier(0.2, 0, 0, 1),
          background-color 180ms ease,
          box-shadow 180ms ease;
      }

      .nav-item:hover {
        background: rgba(45, 79, 103, 0.12);
      }

      .nav-item:active {
        transform: scale(0.96);
      }

      .nav-item:focus-visible {
        outline: none;
        box-shadow:
          inset 0 0 0 1px rgba(126, 156, 216, 0.32),
          0 0 0 4px rgba(126, 156, 216, 0.18);
      }

      .nav-item[data-active="true"] {
        background: rgba(45, 79, 103, 0.2);
        box-shadow: inset 0 0 0 1px rgba(126, 156, 216, 0.16);
      }

      .nav-step {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 42px;
        min-height: 42px;
        padding: 0 10px;
        border-radius: 4px;
        background: rgba(220, 215, 186, 0.06);
        color: var(--text-soft);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        font-variant-numeric: tabular-nums;
      }

      .nav-copy {
        min-width: 0;
      }

      .nav-copy strong,
      .nav-copy small {
        display: block;
      }

      .nav-copy strong {
        color: var(--text);
        font-size: 15px;
        font-weight: 600;
        letter-spacing: -0.01em;
        text-wrap: balance;
      }

      .nav-copy small {
        margin-top: 5px;
        color: var(--text-muted);
        font-size: 13px;
        line-height: 1.45;
        text-wrap: pretty;
      }

      .detail-shell {
        overflow: hidden;
      }

      .detail-panels {
        height: 100%;
        overflow-y: auto;
        padding: 26px 28px;
        background:
          radial-gradient(circle at top right, rgba(126, 156, 216, 0.08), transparent 24%),
          linear-gradient(180deg, rgba(34, 50, 73, 0.2), rgba(31, 31, 40, 0.4));
      }

      .detail-panel {
        display: none;
        min-height: 100%;
        padding: 8px 0 0;
      }

      .detail-panel[data-active="true"] {
        display: block;
      }

      .detail-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 20px;
      }

      .detail-chip {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 0 12px;
        border-radius: 999px;
        background: rgba(152, 187, 108, 0.12);
        color: var(--green);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-variant-numeric: tabular-nums;
      }

      .detail-body > :first-child {
        margin-top: 0;
      }

      .detail-body > :last-child {
        margin-bottom: 0;
      }

      .detail-body h2,
      .detail-body h3,
      .detail-body h4 {
        margin: 0 0 14px;
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        font-weight: 600;
        line-height: 1.05;
        letter-spacing: -0.03em;
        text-wrap: balance;
      }

      .detail-body h2 {
        font-size: clamp(32px, 4vw, 48px);
      }

      .detail-body h3 {
        margin-top: 26px;
        font-size: 20px;
        color: var(--aqua);
      }

      .detail-body h4 {
        margin-top: 22px;
        font-size: 14px;
        color: var(--gold);
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .detail-body p,
      .detail-body li {
        color: var(--text-soft);
        font-size: 18px;
        line-height: 1.7;
        text-wrap: pretty;
      }

      .detail-body p {
        margin: 0 0 14px;
      }

      .detail-body ul {
        display: grid;
        gap: 12px;
        margin: 18px 0 0;
        padding: 0;
        list-style: none;
      }

      .detail-body li {
        position: relative;
        padding: 0 0 0 18px;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      .detail-body li::before {
        content: "";
        position: absolute;
        top: 12px;
        left: 0;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--orange);
        box-shadow: none;
      }

      @media (max-width: 640px) {
        .site {
          grid-template-columns: 1fr;
          height: 100%;
        }

        .sidebar {
          padding: 18px;
        }

        .nav {
          grid-auto-flow: column;
          grid-auto-columns: minmax(180px, 1fr);
          overflow-x: auto;
          overflow-y: hidden;
          padding-bottom: 4px;
        }

        .detail-panels {
          padding: 18px;
        }

        .detail-panel {
          padding-top: 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="site">
      <aside class="sidebar">
        <span class="eyebrow">Project map</span>
        <h1>${escapeHtml(docTitle)}</h1>
        <p>${escapeHtml(introSummary)}</p>
        <nav class="nav" aria-label="Project sections">
          ${navMarkup}
        </nav>
      </aside>

      <section class="detail-shell">
        <div class="detail-panels">
          ${panelMarkup}
        </div>
      </section>
    </main>

    <script>
      const buttons = Array.from(document.querySelectorAll(".nav-item"));
      const panels = Array.from(document.querySelectorAll(".detail-panel"));

      function setActive(id, updateHash) {
        let found = false;

        buttons.forEach((button) => {
          const active = button.dataset.target === id;
          button.dataset.active = active ? "true" : "false";
          if (active) found = true;
        });

        panels.forEach((panel) => {
          const active = panel.dataset.panel === id;
          panel.dataset.active = active ? "true" : "false";
          if (active) {
            panel.scrollIntoView({ block: "nearest" });
          }
        });

        if (!found && buttons[0]) {
          setActive(buttons[0].dataset.target, updateHash);
          return;
        }

        if (updateHash) {
          history.replaceState(null, "", "#" + id);
        }
      }

      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          setActive(button.dataset.target, true);
        });
      });

      window.addEventListener("hashchange", () => {
        const id = window.location.hash.slice(1);
        if (id) setActive(id, false);
      });

      const initial = window.location.hash.slice(1) || (buttons[0] && buttons[0].dataset.target);
      if (initial) {
        setActive(initial, false);
      }
    </script>
  </body>
</html>`;
}
