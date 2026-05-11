# PRD — Slice 11: Image attachments

## Problem Statement

A meaningful share of what people want to ask the Cairn about is visual: a screenshot of a confusing screen, a photo of a paper form they want digitized, a sketch of a layout, a chart from a PDF. Today the Cairn's composer is text-only. The user's options are to describe the image in words (lossy and tiring), to type out URLs the model cannot actually fetch, or to give up on the question. None of those produce a usable conversation. The gap is particularly visible during Scoping — where the user is trying to convey what they want built, and a screenshot would communicate the intent in one shot — and during Implementing, where errors and unexpected UI states are exactly the kind of thing a user would naturally screenshot.

The underlying capability is already present: pi (`@mariozechner/pi-coding-agent`) exposes `AgentSession.prompt(text, { images: ImageContent[] })`, where `ImageContent` is `{ type: "image"; data: base64; mimeType: string }`. The session JSONL persists these parts unchanged. Anthropic's vision-capable models accept them directly. What's missing is the surface: a way to get bytes from the user's machine into that `images` array, a way to render them in the chat, and a way to thread the same shape through the Tauri-to-bun boundary.

Pi has no equivalent for non-image attachments (PDFs, text files, audio). Those would have to be invented in cairn — either inlined into the prompt text or persisted on disk and referenced by path — and each has its own product surface. This slice deliberately stays inside what pi already supports, which is images.

## Solution

The composer gains two ways to attach an image: paste from the clipboard (Cmd+V with an image on the clipboard) and drag-and-drop a file into the textarea. The accepted formats are PNG, JPEG, WebP, and GIF. There is no paperclip button this slice — paste and drop together cover the realistic ways a user gets an image to the composer (screenshot, Finder drag, screenshot tool output), and skipping the native file dialog keeps the surface small.

When an image is accepted, a small thumbnail chip appears above the textarea, with an "×" to remove it. Multiple images can stack. Anything rejected — wrong mime type (e.g. a PDF), oversized (>5 MB), or unreadable — shows a one-line inline reason under the composer and never enters the queue. The user can still type text alongside, or send images alone with no text. Submit clears both fields together.

On send, the user's message bubble in the chat shows the same thumbnails above whatever text they typed, so they have a visual record of what they actually sent. The Cairn replies as usual; it now sees the images on the way in. Reloading the project later re-displays past attachments as thumbnails in the rehydrated transcript — there is no behavioral gap between live and reloaded sessions, because pi already persists the base64 in the session JSONL and the rehydrate path reads it back.

The bug-report bundle does not include image bytes. Stripping them before the dialog stringifies the messages keeps the zip small and avoids accidentally exfiltrating screenshots the user attached in an unrelated turn.

## User Stories

1. As a user, I want to paste a screenshot I just took into the composer with Cmd+V, so that I can show the Cairn what I'm looking at without saving the image to disk first.
2. As a user, I want to drag an image file from Finder into the composer, so that I can attach something I already have on disk without hunting through menus.
3. As a user, I want a small thumbnail to appear above the textarea once an image is accepted, so that I can visually confirm what's about to be sent before I hit return.
4. As a user, I want an "×" on each thumbnail, so that I can remove an image I added by mistake before sending.
5. As a user, I want to attach more than one image at a time, so that I can send a sequence of screenshots in a single message when one isn't enough.
6. As a user, I want to send images with no accompanying text, so that I can say "look at this" with just the image when the image is self-explanatory.
7. As a user, I want a clear one-line reason when an attachment is rejected (wrong type, too big, unreadable), so that I know whether to retry, convert the file, or shrink it.
8. As a user, I want non-image files (PDFs, text files, code) to be rejected with a friendly message, so that I am not confused about why the Cairn isn't responding to a PDF I dropped in.
9. As a user, I want the composer to clear both text and thumbnails together on send, so that the next message starts from a clean slate without a leftover image sneaking into the next turn.
10. As a user, I want my user message bubble in the chat to show the thumbnails I attached, so that I can scroll back and see what I sent in earlier turns.
11. As a user, I want attachments to survive across app restarts and show up as thumbnails when I reopen the project, so that my conversation history is intact and not silently degraded.
12. As a user reporting a bug, I want the bug-report zip to not contain my attached images, so that I am not unintentionally sharing screenshots from unrelated turns when I submit a report.
13. As the developer maintaining this code, I want a single pure validation/encoding module that every attachment passes through, so that the allowlist, size cap, and base64 conversion live in exactly one place and are unit-testable in isolation.
14. As the developer maintaining this code, I want a composer-attachments hook that owns pending attachment state and exposes a tight surface, so that the chat component stays focused on rendering and the attachment lifecycle is testable on its own.
15. As the developer maintaining this code, I want the Tauri command and the sidecar input message to thread images through as the same `{ data, mimeType }` shape pi expects, so that no encoding/decoding work happens at the layer boundary and the field is trivially optional for callers that don't attach anything.
16. As the developer maintaining this code, I want rehydrate to correctly handle a user message whose text content is empty but whose image content is non-empty, so that image-only messages are not silently dropped from the transcript on reload.
17. As the developer maintaining this code, I want a soft per-image cap of 5 MB enforced at the validation boundary, so that an accidental drop of a 50 MB photo doesn't balloon the session JSONL, the IPC payload, or the Anthropic request.

## Implementation Decisions

### `imageAttachment` — pure validation/encoding module (frontend)

A pure module that takes a `File` and asynchronously returns either a successful encoded attachment or a typed rejection. A successful result carries the base64 data (no `data:` prefix), the mime type, a precomputed `dataUrl` for thumbnail rendering, and the byte size. A rejection carries a discriminated reason: `"unsupported-type"`, `"too-large"`, or `"unreadable"`. The module owns the mime allowlist (`image/png`, `image/jpeg`, `image/webp`, `image/gif`) and the 5 MB cap as named constants. It has no React or Tauri dependencies and is the single point of truth for "is this an acceptable attachment." Base64 conversion uses `FileReader.readAsDataURL` and splits the prefix; this is one of two places where pi's `ImageContent.data` shape (raw base64, no prefix) and the browser's data-URL shape are reconciled.

### `useComposerAttachments` — pending-attachment hook (frontend)

A React hook that owns the queue of pending image attachments for the composer. Its surface: `images` (array of `{ id, data, mimeType, dataUrl, bytes }`), `addFiles(files)` (validates each through `imageAttachment` and appends successes), `remove(id)`, `clear()`, and `rejections` (transient list of `{ id, fileName, reason }` for showing the inline error; clears on the next `addFiles` call so a successful drop wipes the prior error). IDs are locally generated for keying React lists; they do not flow downstream.

This hook is the integration point for the paste handler (a `paste` event listener on the textarea that pulls `DataTransferItem`s of kind `"file"` whose type starts with `"image/"` and feeds them to `addFiles`) and the drop handler (a `drop` listener with the usual `dragover` preventDefault dance that pulls `DataTransfer.files` and feeds them to `addFiles`).

### `ChatMessage` shape extension (frontend)

`ChatMessage` in `chat-stream` gains an optional `images?: Array<{ dataUrl: string; mimeType: string }>` field. Assistant messages never carry images (pi's assistant `content` is `(TextContent | ThinkingContent | ToolCall)[]`, no image variant), so the existing `applyAssistantDelta` and `markAssistantDone` need no changes. The field defaults to absent — components must treat undefined as "no images" without conditional explosions elsewhere.

### Chat bubble rendering (frontend)

User-message bubbles render a thumbnail strip above the text when `images` is non-empty. Thumbnails are plain `<img>` elements with a max height (≈80 px) and `object-fit: contain`, arranged in a horizontal row that wraps. No lightbox, no click-to-zoom — those are explicitly deferred. Alt text is the mime type as a fallback; the bytes are the actual content so screen-reader experience is intentionally minimal in this slice.

### `useSidecarSession.sendPrompt` signature

`sendPrompt(text, images?)`. The local optimistic user message is constructed with the thumbnail-shaped `images` (only `dataUrl` and `mimeType`); the Tauri invoke payload carries the pi-shaped `images` (`data` + `mimeType`). The composer is responsible for clearing its attachment queue after a successful invoke, the same way it clears the text. If the invoke rejects (and we currently roll back the optimistic assistant placeholder), we also roll back the user message's image visibility — concretely the optimistic insert happens before invoke and the rollback path removes both messages on failure.

### Tauri `send_prompt` command (Rust)

The `send_prompt` Tauri command signature grows an optional `images: Option<Vec<ImagePayload>>` parameter, where `ImagePayload` is a Rust struct of `{ data: String, mime_type: String }` serialized with serde's `rename_all = "camelCase"` so the JS side passes `mimeType`. The command serializes `{ "type": "prompt", "text": ..., "images": [...] }` (with `images` omitted when empty) and writes the line to the sidecar's stdin. No size validation in Rust — the JS side has already validated, and the IPC layer's tolerance for the payload size is the same as the sidecar's tolerance for the resulting JSON line.

### Sidecar `InMsg.prompt` and `handlePrompt`

The `prompt` variant of `InMsg` gains an optional `images?: ImageContent[]` field. `handlePrompt` passes it through to `session.prompt(text, { images })` when present. Pi's `ImageContent` shape matches the wire shape exactly (`{ type: "image", data, mimeType }`), but the wire format omits the `type: "image"` discriminator (Tauri sends `{ data, mimeType }`), so `handlePrompt` maps each wire image to a full `ImageContent` literal before forwarding. This is the only piece of structural translation in the pipeline.

### `hydrate.ts` — image extraction

`HydrateMessage` gains an optional `images?: Array<{ dataUrl: string; mimeType: string }>`. `toHydrateMessage` walks `message.content` for parts of type `"image"`, builds a `data:${mimeType};base64,${data}` URL for each, and attaches them to the message. The early-return that currently drops messages whose extracted text is empty is widened: a message survives if it has either non-empty text or at least one image. Assistant messages are unaffected because pi's assistant content has no image variant.

### `BugReportDialog` — image scrub

Before stringifying `messages` into the bug-report JSON, the dialog maps over `messages` and replaces each `images` array with one carrying only the count and mime types (e.g. `[{ mimeType: "image/png" }]`). This preserves enough signal for a developer to know "user had attachments at this turn" without shipping the actual bytes. The scrub happens in the dialog, not in the bundler — it's a frontend concern about what gets handed to the Tauri command, not something the Rust side enforces.

### File and mime constraints

`image/png`, `image/jpeg`, `image/webp`, `image/gif`. 5 MB per image, no aggregate cap (Anthropic's request limits handle the long tail). The constants live in `imageAttachment` so any future relaxation or tightening is a one-file change.

### What lives where, in one sentence

The frontend owns validation, encoding, and display; the Tauri command owns transport; the sidecar owns mapping wire shape to `ImageContent` and calling pi; pi owns persistence and the Anthropic round-trip.

## Testing Decisions

A good test for this slice exercises external behavior at the boundary of each deep module — given a `File`, does `imageAttachment` produce the right encoded payload or rejection; given a sequence of adds/removes, does `useComposerAttachments` report the right state; given a session entry with image content, does `hydrate` surface the right `HydrateMessage`. Implementation details — internal helper functions, exact React state-shape, the precise wording of an inline error message — are not asserted on.

**`imageAttachment`** — vitest unit tests modeled after the `briefArtifact.test.ts` / `planArtifact.test.ts` patterns (file-colocated). Cases: each allowed mime (png, jpeg, webp, gif) resolves to a payload whose `mimeType` and `bytes` match the input and whose `dataUrl` starts with `data:${mimeType};base64,`; an unsupported mime (`application/pdf`, `text/plain`) rejects with `"unsupported-type"`; a >5 MB file rejects with `"too-large"`; a successful encode round-trips the bytes through base64 (`atob(result.data)` matches the original file's bytes). `File` and `FileReader` are available under the vitest jsdom environment already in use elsewhere; no new test infrastructure is needed.

**`useComposerAttachments`** — vitest + Testing Library `renderHook` test, modeled after the existing hook tests (`useActivePanelTab.test.ts`, `useCreatingIndicator.test.ts`). Cases: `addFiles` with one valid image and one rejected file produces a one-item `images` and a one-item `rejections`; a subsequent successful `addFiles` clears prior `rejections`; `remove(id)` drops the matching attachment and preserves others; `clear()` empties both `images` and `rejections`. The hook calls into `imageAttachment` directly — no mocking — because the validation module is already covered by its own tests and the hook's contract includes "uses the canonical validator."

**`hydrate.ts`** — extend the existing `sidecar/tests/hydrate.test.ts`. Cases: a user message with both text and image content surfaces a `HydrateMessage` with both `text` and `images`; a user message with image content and empty text surfaces a `HydrateMessage` with empty `text` and a non-empty `images` and is **not** filtered out (the regression this test prevents is the current "drop messages with empty text" early-return); a user message with text and no images surfaces a `HydrateMessage` with `images` absent or undefined; the `dataUrl` is the expected `data:${mimeType};base64,${data}` string for round-trip fidelity.

**Deliberately not tested:** the Tauri `send_prompt` Rust command (the addition is purely passthrough — covered by the existing protocol/sidecar shape tests and by manual smoke); `useSidecarSession.sendPrompt` (its signature change is mechanical and covered by the manual smoke); the chat-bubble thumbnail rendering (CSS + `<img>` is not meaningfully testable in vitest, covered by manual smoke); `BugReportDialog`'s image scrub (covered by extending the existing dialog test only if it stays low-friction — otherwise manual). Manual smoke for this slice: paste a screenshot, drop a JPEG, drop a PDF (expect rejection), drop a 10 MB photo (expect rejection), send an image-only message, reload the project and confirm thumbnails reappear, file a bug report and confirm the zip's `dev-events.json` has no `dataUrl` fields.

## Out of Scope

- **Non-image attachments (PDFs, text files, code, audio).** Pi has no native surface for these, so adding them is a product decision (inline as text, persist by path, etc.) that deserves its own slice. The error path in this slice rejects them with a friendly reason so users get a usable signal.
- **Paperclip / file-picker button.** Paste + drop covers the realistic ways an image arrives at the composer. Adding a native file dialog is a small follow-up if dogfooders ask, but it duplicates code paths and requires capability wiring that is not worth the noise right now.
- **Lightbox / click-to-zoom on thumbnails.** The thumbnail strip is read-only in this slice. If a user needs to inspect an image more closely, they can ask the Cairn about it or revisit the original file. A real lightbox is a UX-affecting feature with its own design surface.
- **Drag-and-drop reordering of pending thumbnails.** Order in the queue is insertion order; rearranging requires remove + readd. Real reordering is a follow-up only if it turns out to matter.
- **Per-attachment text annotations / captions.** The user types one text block per turn. Per-image captions would require a UI affordance and a way to ferry them through pi (which has no such field), so they're firmly out.
- **Aggregate size cap across all attachments in one turn.** Per-image is enforced; the Anthropic request limit handles the long tail. A real aggregate cap requires a product call on what to do at the boundary, which is not worth making now.
- **Server-side downscaling / re-encoding.** Images are sent at their original byte size and mime type. Downscaling would save tokens but introduces a quality-vs-bandwidth call and a new dependency, neither of which is justified at current usage.
- **Including images in bug-report bundles.** Explicitly excluded; the scrub step is the implementation of this decision. A future "user-facing redaction toggle" slice may reopen this.
- **Audio/video attachments.** Pi has no surface for either, and Anthropic's API only recently added file support beyond images. Out of scope until pi exposes it.

## Further Notes

- The trickiest implementation pitfall is the hydrate empty-text early-return in `toHydrateMessage`. If it isn't widened to also accept image-bearing messages, image-only user messages will silently disappear on every reload — and the bug is invisible during dev because live-streamed messages don't go through `toHydrateMessage`. The hydrate test case for "image content, empty text, message survives" is the load-bearing test in this slice.
- Pi's `ImageContent` matches the wire shape exactly except for the `type: "image"` discriminator. Doing the mapping in the sidecar (rather than carrying `type: "image"` through Rust) keeps the Rust struct minimal and avoids a tagged-union over the IPC boundary for one variant.
- The 5 MB cap is a soft default chosen to keep the session JSONL and the Tauri IPC payload reasonable. Screenshots are typically <2 MB. A high-res photo from a recent iPhone is 3–5 MB. If the cap turns out to bite, raise it; if it turns out users routinely hit it, consider client-side downscaling as a follow-up.
- Pi already persists `ImageContent` in the session JSONL, which means once this slice lands, every existing session JSONL is forward-compatible: an old session has no image parts, hydrate handles that case, no migration needed. New sessions accumulate image parts that older builds of cairn would simply not render (graceful degradation), which matters if a user downgrades or runs an old branch.
- The bug-report scrub is intentionally implemented in the dialog (frontend), not in the Rust bundler, because the Rust side does not parse the JSON payload — it writes the string verbatim. Pushing the scrub to the layer that owns the schema is cleaner than teaching the bundler about chat-message shape.
- After this slice lands, the natural follow-ups in priority order are: (1) paperclip/file-picker button if dogfooders ask, (2) a thin "inline a small text file" path for `.txt`/`.md`/source files, (3) lightbox, (4) drag-reorder. Each is its own small slice; none is blocked on this one beyond the obvious "attachment surface exists."
