# PRD - Slice 13: On-demand agent diagnostics

## Problem Statement

When an agent drives Cairn through the Tauri MCP, it can see the UI and it can inspect session JSONL after the fact, but it cannot reliably see the runtime path where messages disappear. During recent dogfooding, assistant text existed in persisted session state but was missing from chat. The useful questions were concrete: did the sidecar emit the text delta, did Rust forward it, did the frontend listener receive it, and did React state accept it? Today those answers require indirect source-code reasoning or asking the human user to copy terminal output.

Always-on filesystem logging would solve part of that problem, but it creates its own obligations. Protocol deltas and console output can be noisy. If logs persist by default, Cairn has to handle rotation, retention, privacy, redaction, production behavior, and bug-report leakage. That is too much product surface for a diagnostic feature whose primary consumer is an agent actively debugging a live development session.

The missing capability is a bounded, intentional diagnostic mode that an agent can enable before reproducing a bug, read after the reproduction, and clear afterward. It should expose enough structured lifecycle evidence to locate the failing layer without turning Cairn into an always-on telemetry system.

## Solution

Cairn gains an on-demand diagnostics mode in debug builds. A model or developer can start diagnostics through a dev/MCP-readable command, reproduce the issue, then read the captured diagnostic events from a bounded in-memory buffer. Diagnostics are off by default, cleared on restart, and limited by an event cap and optional time-to-live.

The captured stream focuses on lifecycle evidence rather than raw content. By default, it records event type, source, timestamp, message id or tool-call id when available, text lengths, target/module names, levels, and error summaries. It does not record full prompts, full assistant deltas, or user content unless explicitly requested through an unsafe debug option. The default mode should be enough to answer "where did the event stop?" without preserving sensitive text.

The first version exposes sidecar and backend diagnostic events end-to-end. A follow-up slice can add frontend console capture once the core collector and read path are proven. A later slice can optionally add an export snapshot, but persistent file logging is not part of this PRD.

## User Stories

1. As an agent debugging Cairn through MCP, I want to start diagnostics before reproducing a bug so that the runtime evidence begins at the point I care about.
2. As an agent debugging Cairn through MCP, I want to read the last diagnostic events after reproducing a bug so that I can determine whether the failure happened in the sidecar, Rust host, or frontend.
3. As an agent debugging missing assistant text, I want diagnostic events for assistant text lifecycle milestones so that I can compare sidecar emission, host forwarding, and UI receipt without relying on full text bodies.
4. As a developer, I want diagnostics off by default so that normal app use does not create noisy retained logs.
5. As a developer, I want diagnostics gated to debug/dev builds so that production binaries do not ship an agent-oriented runtime logging surface.
6. As a developer, I want the diagnostic store to be bounded in memory so that a long-running debug session cannot fill the disk or grow without limit.
7. As a developer, I want diagnostics to redact user and assistant text by default so that debugging does not silently retain prompts, secrets, or proprietary output.
8. As a developer, I want a way to opt into text snippets only when explicitly requested so that rare content-level bugs can still be investigated with an intentional privacy trade-off.
9. As a developer, I want diagnostics to include cursor ids so that a reader can poll incrementally instead of re-reading the same buffer every time.
10. As a developer, I want diagnostics to auto-stop after a reasonable time-to-live so that a forgotten debug session does not keep collecting forever.
11. As a developer, I want start, stop, read, and clear operations to be small and stable so that the MCP bridge, Dev Panel, or future CLI tools can all sit on the same backend primitive.
12. As a developer, I want sidecar stderr/dev events to continue feeding the existing Dev Panel while also feeding diagnostics when enabled so that the new feature reuses the current event path.
13. As a developer, I want backend errors and sidecar protocol forwarding milestones captured in the same ordered stream so that cross-runtime ordering is visible from one read.
14. As a developer, I want malformed diagnostic control requests to fail clearly so that an agent does not silently believe diagnostics are running when they are not.
15. As a developer, I want tests around redaction, buffer bounds, cursors, and lifecycle state so that the safety properties of the collector do not regress.

## Implementation Decisions

- Add a deep diagnostics collector module in the Rust host. Its public interface is intentionally small: start with options, stop, clear, record event, read from cursor, and get status. The collector owns enabled state, source filters, redaction policy, max event count, cursor allocation, and optional time-to-live.
- Diagnostics are debug/dev-only. The implementation should be compiled or registered only when the existing MCP bridge/debug tooling is available. Production builds should not expose the diagnostic commands.
- The collector stores structured diagnostic events in memory only. Events include a monotonically increasing cursor, timestamp, source, level, event name, and structured metadata. The buffer drops oldest events when it exceeds the configured cap.
- Start options include source selection, max events, optional time-to-live, and an explicit include-text mode. Defaults are privacy-safe: sidecar and backend sources enabled, bounded event count, no full text, no persistent file output.
- Redaction is a first-class collector behavior, not a UI concern. Callers record semantic metadata such as text length, message id, and event type. If an event offers text, the collector stores either length-only metadata by default or a bounded snippet only when include-text is explicitly enabled.
- Sidecar stderr/dev events feed diagnostics through the existing host path that already formats and buffers sidecar dev events for the Dev Panel. Existing Dev Panel behavior remains intact.
- Sidecar stdout protocol handling records selected milestones rather than full payloads. For example, text delta forwarding records event type and delta length; hydrate records message count; errors record the error summary.
- Backend log/error events are captured where Cairn already records recoverable errors and host-side warnings. This slice does not require replacing the Rust logging stack with tracing.
- Frontend console capture is deliberately not in the first implementation slice. The collector API should include a frontend source so a later slice can send sanitized frontend events into the same stream, but the first version should prove the control/read path with sidecar and backend events.
- The MCP-visible surface should be backed by Tauri commands that are safe to call from the MCP bridge. The expected operations are start diagnostics, stop diagnostics, read diagnostics, clear diagnostics, and diagnostics status.
- Read operations support a limit and optional cursor. The response includes the events returned, the newest cursor currently retained, whether diagnostics are enabled, and whether earlier events were dropped.
- The existing dev-mode UI may read the same diagnostic status or stream in a later slice, but no new user-facing panel is required for the first version.
- Persistent filesystem logs, log rotation, and production telemetry integrations are intentionally avoided. If a future bug-report flow needs an export, it should export a bounded snapshot from the in-memory buffer rather than keep a rolling file.

## Testing Decisions

- The collector module gets focused unit tests around external behavior: start/stop state, max event retention, dropped-event reporting, cursor reads, clear semantics, time-to-live expiry, source filtering, and redaction.
- Redaction tests are load-bearing. A default diagnostic event with text must not store the raw text; it should store length and safe metadata. An explicit include-text mode may store a bounded snippet and must truncate predictably.
- Host integration tests cover that selected sidecar dev events are recorded when diagnostics are enabled and ignored when diagnostics are disabled.
- Command tests cover malformed options, default options, start/read/stop flow, and read-from-cursor behavior. The tests should assert command responses, not internal lock or buffer details.
- Existing frontend tests do not need to change in the first slice because no new user-visible UI is required.
- Manual smoke for the first implementation: start diagnostics through the MCP/Tauri command path, send a prompt that produces assistant text, read diagnostics, confirm sidecar/backend lifecycle events appear with lengths and ids but without full prompt or assistant text, then stop and confirm no new events are collected.

## Out of Scope

- **Always-on filesystem logging.** This creates storage, retention, and privacy obligations that the current debugging need does not require.
- **Production binary diagnostics.** The diagnostic control surface is for dev/MCP debugging and should not ship as a production capability.
- **OpenTelemetry, Sentry, or full tracing migration.** Those tools may be useful later, but the current need is a local, bounded diagnostic stream.
- **Frontend console capture in the first implementation slice.** The collector should be shaped to accept frontend events later, but the first vertical slice can prove value with sidecar and backend events.
- **Full prompt or model-output retention by default.** Default diagnostics must answer lifecycle questions without storing content.
- **A new in-app Dev Panel redesign.** The existing Dev Panel can remain as-is; MCP-readable diagnostics are the initial consumer.
- **Bug-report bundle integration.** A future slice may export a bounded diagnostics snapshot, but this PRD does not add it to bug reports.
- **Long-term performance profiling.** This is not flamegraph, CPU profiling, distributed tracing, or span visualization.

## Further Notes

The core architectural decision is that the canonical diagnostic stream is a transient in-memory collector, not a file and not MCP itself. MCP is only a reader/control surface. That keeps the feature intentional, bounded, and easy to remove from production builds.

The first implementation should be conservative about content. For the recent missing-message class of bugs, the key facts are event order, event type, ids, and text lengths. Full text is tempting, but it turns a small debugging tool into a privacy-sensitive log store.

This PRD traces back to GitHub issue #121. The original issue framed three possible directions: sidecar logs only, unified structured tail, or diagnostic dump. The chosen scope is a narrow version of the unified tail: on-demand, in-memory, debug-only, and initially limited to sidecar/backend events.
