import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRoutes } from "../App";

describe("GlossaryPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the dedicated glossary workspace page", async () => {
    render(
      <MemoryRouter initialEntries={["/glossary"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Glossary library" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to interpreter" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No glossary terms yet. Add one to guide realtime translation."),
    ).toBeInTheDocument();
  });
});
