export const IMAGE_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const IMAGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export type ImageAttachmentMimeType =
  (typeof IMAGE_ATTACHMENT_MIME_TYPES)[number];

export type ImageAttachment = {
  data: string;
  mimeType: ImageAttachmentMimeType;
  dataUrl: string;
  bytes: number;
};

export type ImageAttachmentRejectionReason =
  | "unsupported-type"
  | "too-large"
  | "unreadable";

export type ImageAttachmentResult =
  | { ok: true; attachment: ImageAttachment }
  | { ok: false; reason: ImageAttachmentRejectionReason };

const imageAttachmentMimeTypeSet = new Set<string>(IMAGE_ATTACHMENT_MIME_TYPES);

export function isImageAttachmentMimeType(
  mimeType: string,
): mimeType is ImageAttachmentMimeType {
  return imageAttachmentMimeTypeSet.has(mimeType);
}

function dataUrlPayload(dataUrl: string) {
  const separator = dataUrl.indexOf(",");
  if (separator < 0) return null;
  return dataUrl.slice(separator + 1);
}

export async function encodeImageAttachment(
  file: File,
): Promise<ImageAttachmentResult> {
  if (!isImageAttachmentMimeType(file.type)) {
    return { ok: false, reason: "unsupported-type" };
  }

  if (file.size > IMAGE_ATTACHMENT_MAX_BYTES) {
    return { ok: false, reason: "too-large" };
  }

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("FileReader returned non-string result."));
      };
      reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
      reader.readAsDataURL(file);
    });
    const data = dataUrlPayload(dataUrl);
    if (!data) return { ok: false, reason: "unreadable" };

    return {
      ok: true,
      attachment: {
        data,
        mimeType: file.type,
        dataUrl,
        bytes: file.size,
      },
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
