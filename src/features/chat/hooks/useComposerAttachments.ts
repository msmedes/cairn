import { useState } from "react";
import {
  encodeImageAttachment,
  type ImageAttachment,
  type ImageAttachmentRejectionReason,
} from "../imageAttachment";

export type ComposerImageAttachment = ImageAttachment & {
  id: string;
};

export type ComposerImageRejection = {
  id: string;
  fileName: string;
  reason: ImageAttachmentRejectionReason;
};

function newId() {
  return crypto.randomUUID();
}

export function useComposerAttachments() {
  const [images, setImages] = useState<ComposerImageAttachment[]>([]);
  const [rejections, setRejections] = useState<ComposerImageRejection[]>([]);

  async function addFiles(files: Iterable<File>) {
    const nextImages: ComposerImageAttachment[] = [];
    const nextRejections: ComposerImageRejection[] = [];

    for (const file of files) {
      const result = await encodeImageAttachment(file);
      if (result.ok) {
        nextImages.push({ id: newId(), ...result.attachment });
      } else {
        nextRejections.push({
          id: newId(),
          fileName: file.name,
          reason: result.reason,
        });
      }
    }

    setImages((current) => [...current, ...nextImages]);
    setRejections(nextRejections);
  }

  function remove(id: string) {
    setImages((current) => current.filter((image) => image.id !== id));
  }

  function clear() {
    setImages([]);
    setRejections([]);
  }

  return { images, addFiles, remove, clear, rejections };
}
