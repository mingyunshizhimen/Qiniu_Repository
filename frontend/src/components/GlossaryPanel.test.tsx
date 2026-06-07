import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlossaryPanel, type GlossaryHit } from "./GlossaryPanel";

const fetchMock = vi.fn();

describe("GlossaryPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("loads glossary terms and renders current term hits", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "term-1",
          source_term: "七牛云",
          target_term: "Qiniu Cloud",
          description: "品牌名",
          enabled: true,
        },
      ],
    });

    const termHits: GlossaryHit[] = [
      {
        sourceTerm: "七牛云",
        targetTerm: "Qiniu Cloud",
        startIndex: 0,
      },
    ];

    render(<GlossaryPanel termHits={termHits} />);

    expect(
      await screen.findByText("Qiniu Cloud"),
    ).toBeInTheDocument();
    expect(screen.getByText("Current term hits")).toBeInTheDocument();
    expect(screen.getAllByText("七牛云")).toHaveLength(2);
  });

  it("creates, toggles, and deletes glossary terms", async () => {
    const user = userEvent.setup();

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "term-1",
          source_term: "对象存储",
          target_term: "Object Storage",
          description: "存储产品",
          enabled: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "term-1",
          source_term: "对象存储",
          target_term: "Object Storage",
          description: "存储产品",
          enabled: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
      });

    render(<GlossaryPanel termHits={[]} />);

    await user.type(screen.getByLabelText("Source term"), "对象存储");
    await user.type(screen.getByLabelText("Target term"), "Object Storage");
    await user.type(screen.getByLabelText("Description"), "存储产品");
    await user.click(screen.getByRole("button", { name: "Add term" }));

    expect(await screen.findByText("Object Storage")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/glossary/terms",
      expect.objectContaining({
        method: "POST",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Disable term 对象存储" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/v1/glossary/terms/term-1",
        expect.objectContaining({
          method: "PATCH",
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: "Delete term 对象存储" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/v1/glossary/terms/term-1",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });
  });
});
