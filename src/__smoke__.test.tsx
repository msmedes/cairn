import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("renders through React Testing Library in jsdom", () => {
  render(<main aria-label="Smoke test">Cairn frontend test smoke</main>);

  expect(screen.getByLabelText("Smoke test")).toBeInTheDocument();
});
