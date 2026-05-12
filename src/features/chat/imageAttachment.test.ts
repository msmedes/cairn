import { describe, expect, test } from "vitest";
import {
  encodeImageAttachment,
  IMAGE_ATTACHMENT_MAX_BYTES,
  IMAGE_ATTACHMENT_MIME_TYPES,
} from "./imageAttachment";

function fileFor(mimeType: string, bytes = new Uint8Array([1, 2, 3, 254])) {
  return new File([bytes], `fixture.${mimeType.split("/")[1] ?? "bin"}`, {
    type: mimeType,
  });
}

describe("encodeImageAttachment", () => {
  test.each(
    IMAGE_ATTACHMENT_MIME_TYPES,
  )("accepts %s and returns thumbnail-ready data", async (mimeType) => {
    const bytes = new Uint8Array([0, 23, 42, 255]);
    const result = await encodeImageAttachment(fileFor(mimeType, bytes));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected image attachment");
    expect(result.attachment.mimeType).toBe(mimeType);
    expect(result.attachment.bytes).toBe(bytes.byteLength);
    expect(result.attachment.dataUrl).toMatch(
      new RegExp(`^data:${mimeType};base64,`),
    );
  });

  test.each([
    "application/pdf",
    "text/plain",
  ])("rejects %s as unsupported", async (mimeType) => {
    const result = await encodeImageAttachment(fileFor(mimeType));

    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported-type",
    });
  });

  test("rejects images larger than the maximum byte size", async () => {
    const result = await encodeImageAttachment(
      fileFor("image/png", new Uint8Array(IMAGE_ATTACHMENT_MAX_BYTES + 1)),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "too-large",
    });
  });

  test("returns base64 data that round-trips to the original bytes", async () => {
    const bytes = new Uint8Array([67, 97, 105, 114, 110]);
    const result = await encodeImageAttachment(fileFor("image/png", bytes));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected image attachment");
    const decoded = Uint8Array.from(atob(result.attachment.data), (char) =>
      char.charCodeAt(0),
    );
    expect(decoded).toEqual(bytes);
  });
});
