import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useComposerAttachments } from "./useComposerAttachments";

function fileFor(name: string, mimeType: string, bytes = new Uint8Array([1])) {
  return new File([bytes], name, { type: mimeType });
}

describe("useComposerAttachments", () => {
  test("adds valid images, reports rejections, removes, and clears", async () => {
    const { result } = renderHook(() => useComposerAttachments());

    await act(async () => {
      await result.current.addFiles([
        fileFor("screen.png", "image/png"),
        fileFor("notes.txt", "text/plain"),
      ]);
    });

    await waitFor(() => {
      expect(result.current.images).toHaveLength(1);
      expect(result.current.rejections).toHaveLength(1);
    });
    expect(result.current.images[0]).toMatchObject({
      mimeType: "image/png",
      bytes: 1,
    });
    expect(result.current.rejections[0]).toMatchObject({
      fileName: "notes.txt",
      reason: "unsupported-type",
    });

    await act(async () => {
      await result.current.addFiles([fileFor("photo.jpg", "image/jpeg")]);
    });

    await waitFor(() => {
      expect(result.current.images).toHaveLength(2);
      expect(result.current.rejections).toHaveLength(0);
    });

    const firstId = result.current.images[0].id;
    act(() => {
      result.current.remove(firstId);
    });

    expect(result.current.images).toHaveLength(1);
    expect(result.current.images[0].mimeType).toBe("image/jpeg");

    act(() => {
      result.current.clear();
    });

    expect(result.current.images).toEqual([]);
    expect(result.current.rejections).toEqual([]);
  });
});
