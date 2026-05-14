use std::collections::BTreeSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const DEFAULT_MAX_EVENTS: usize = 500;
const MAX_ALLOWED_EVENTS: usize = 5_000;
const DEFAULT_TTL_SECONDS: u64 = 15 * 60;
const MAX_TTL_SECONDS: u64 = 60 * 60;
const MAX_TEXT_SNIPPET_CHARS: usize = 160;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiagnosticSource {
    Sidecar,
    Backend,
    Frontend,
    Ipc,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiagnosticLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticStartOptions {
    #[serde(default)]
    pub(crate) sources: Vec<DiagnosticSource>,
    #[serde(default)]
    pub(crate) max_events: Option<usize>,
    #[serde(default)]
    pub(crate) ttl_seconds: Option<u64>,
    #[serde(default)]
    pub(crate) include_text: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticStatus {
    pub(crate) enabled: bool,
    pub(crate) sources: Vec<DiagnosticSource>,
    pub(crate) max_events: usize,
    pub(crate) ttl_seconds: Option<u64>,
    pub(crate) include_text: bool,
    pub(crate) event_count: usize,
    pub(crate) newest_cursor: u64,
    pub(crate) oldest_cursor: Option<u64>,
    pub(crate) dropped_events: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticReadOptions {
    #[serde(default)]
    pub(crate) cursor: Option<u64>,
    #[serde(default)]
    pub(crate) limit: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticReadResponse {
    pub(crate) enabled: bool,
    pub(crate) events: Vec<DiagnosticEvent>,
    pub(crate) newest_cursor: u64,
    pub(crate) oldest_cursor: Option<u64>,
    pub(crate) dropped_events: u64,
    pub(crate) has_more: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticEvent {
    pub(crate) cursor: u64,
    pub(crate) timestamp_ms: u64,
    pub(crate) source: DiagnosticSource,
    pub(crate) level: DiagnosticLevel,
    pub(crate) name: String,
    pub(crate) metadata: Map<String, Value>,
}

#[derive(Clone, Debug)]
pub(crate) struct DiagnosticRecord {
    source: DiagnosticSource,
    level: DiagnosticLevel,
    name: String,
    metadata: Map<String, Value>,
    text: Option<String>,
}

impl DiagnosticRecord {
    pub(crate) fn new(
        source: DiagnosticSource,
        level: DiagnosticLevel,
        name: impl Into<String>,
    ) -> Self {
        Self {
            source,
            level,
            name: name.into(),
            metadata: Map::new(),
            text: None,
        }
    }

    pub(crate) fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    pub(crate) fn with_safe_string(
        mut self,
        key: impl Into<String>,
        value: impl Into<String>,
    ) -> Self {
        self.metadata.insert(key.into(), Value::from(value.into()));
        self
    }

    pub(crate) fn with_u64(mut self, key: impl Into<String>, value: u64) -> Self {
        self.metadata.insert(key.into(), Value::from(value));
        self
    }

    pub(crate) fn with_bool(mut self, key: impl Into<String>, value: bool) -> Self {
        self.metadata.insert(key.into(), Value::from(value));
        self
    }

    pub(crate) fn with_value(mut self, key: impl Into<String>, value: Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }
}

#[derive(Debug)]
pub(crate) struct Diagnostics {
    enabled: bool,
    sources: BTreeSet<DiagnosticSource>,
    max_events: usize,
    ttl_seconds: Option<u64>,
    include_text: bool,
    started_at_ms: Option<u64>,
    next_cursor: u64,
    dropped_events: u64,
    events: Vec<DiagnosticEvent>,
}

impl Default for Diagnostics {
    fn default() -> Self {
        Self {
            enabled: false,
            sources: default_sources(),
            max_events: DEFAULT_MAX_EVENTS,
            ttl_seconds: Some(DEFAULT_TTL_SECONDS),
            include_text: false,
            started_at_ms: None,
            next_cursor: 1,
            dropped_events: 0,
            events: Vec::new(),
        }
    }
}

impl Diagnostics {
    pub(crate) fn start(
        &mut self,
        options: Option<DiagnosticStartOptions>,
        now_ms: u64,
    ) -> Result<DiagnosticStatus, String> {
        let options = options.unwrap_or_else(default_start_options);
        let sources = if options.sources.is_empty() {
            default_sources()
        } else {
            options.sources.into_iter().collect::<BTreeSet<_>>()
        };
        if sources.is_empty() {
            return Err("diagnostic sources cannot be empty".into());
        }

        let max_events = options.max_events.unwrap_or(DEFAULT_MAX_EVENTS);
        if !(1..=MAX_ALLOWED_EVENTS).contains(&max_events) {
            return Err(format!(
                "maxEvents must be between 1 and {MAX_ALLOWED_EVENTS}"
            ));
        }

        let ttl_seconds = options.ttl_seconds.or(Some(DEFAULT_TTL_SECONDS));
        if matches!(ttl_seconds, Some(0)) {
            return Err("ttlSeconds must be greater than 0".into());
        }
        if ttl_seconds.is_some_and(|ttl| ttl > MAX_TTL_SECONDS) {
            return Err(format!("ttlSeconds must be at most {MAX_TTL_SECONDS}"));
        }

        self.enabled = true;
        self.sources = sources;
        self.max_events = max_events;
        self.ttl_seconds = ttl_seconds;
        self.include_text = options.include_text;
        self.started_at_ms = Some(now_ms);
        self.events.clear();
        self.dropped_events = 0;

        Ok(self.status(now_ms))
    }

    pub(crate) fn stop(&mut self, now_ms: u64) -> DiagnosticStatus {
        self.expire_if_needed(now_ms);
        self.enabled = false;
        self.status(now_ms)
    }

    pub(crate) fn clear(&mut self) {
        self.events.clear();
        self.dropped_events = 0;
    }

    pub(crate) fn status(&mut self, now_ms: u64) -> DiagnosticStatus {
        self.expire_if_needed(now_ms);
        DiagnosticStatus {
            enabled: self.enabled,
            sources: self.sources.iter().copied().collect(),
            max_events: self.max_events,
            ttl_seconds: self.ttl_seconds,
            include_text: self.include_text,
            event_count: self.events.len(),
            newest_cursor: self.newest_cursor(),
            oldest_cursor: self.oldest_cursor(),
            dropped_events: self.dropped_events,
        }
    }

    pub(crate) fn record(&mut self, record: DiagnosticRecord, now_ms: u64) -> bool {
        self.expire_if_needed(now_ms);
        if !self.enabled || !self.sources.contains(&record.source) {
            return false;
        }

        let mut metadata = sanitize_metadata(record.metadata);
        if let Some(text) = record.text {
            metadata.insert("textLength".into(), Value::from(text.chars().count()));
            if self.include_text {
                metadata.insert("textSnippet".into(), Value::from(snippet(&text)));
            }
        }

        let event = DiagnosticEvent {
            cursor: self.next_cursor,
            timestamp_ms: now_ms,
            source: record.source,
            level: record.level,
            name: record.name,
            metadata,
        };
        self.next_cursor += 1;
        self.events.push(event);
        self.enforce_limit();
        true
    }

    pub(crate) fn read(
        &mut self,
        options: Option<DiagnosticReadOptions>,
        now_ms: u64,
    ) -> Result<DiagnosticReadResponse, String> {
        self.expire_if_needed(now_ms);
        let options = options.unwrap_or(DiagnosticReadOptions {
            cursor: None,
            limit: None,
        });
        let limit = options.limit.unwrap_or(self.max_events);
        if limit == 0 {
            return Err("limit must be greater than 0".into());
        }

        let events = if let Some(cursor) = options.cursor {
            self.events
                .iter()
                .filter(|event| event.cursor > cursor)
                .take(limit)
                .cloned()
                .collect::<Vec<DiagnosticEvent>>()
        } else {
            let start = self.events.len().saturating_sub(limit);
            self.events[start..].to_vec()
        };
        let last_returned = events.last().map(|event| event.cursor);
        let has_more = last_returned.is_some_and(|cursor| {
            self.events
                .last()
                .is_some_and(|event| event.cursor > cursor)
        });

        Ok(DiagnosticReadResponse {
            enabled: self.enabled,
            events,
            newest_cursor: self.newest_cursor(),
            oldest_cursor: self.oldest_cursor(),
            dropped_events: self.dropped_events,
            has_more,
        })
    }

    fn expire_if_needed(&mut self, now_ms: u64) {
        let Some(ttl_seconds) = self.ttl_seconds else {
            return;
        };
        let Some(started_at_ms) = self.started_at_ms else {
            return;
        };
        if now_ms.saturating_sub(started_at_ms) >= ttl_seconds.saturating_mul(1_000) {
            self.enabled = false;
        }
    }

    fn enforce_limit(&mut self) {
        if self.events.len() <= self.max_events {
            return;
        }
        let overflow = self.events.len() - self.max_events;
        self.events.drain(0..overflow);
        self.dropped_events += overflow as u64;
    }

    fn newest_cursor(&self) -> u64 {
        self.events.last().map_or(0, |event| event.cursor)
    }

    fn oldest_cursor(&self) -> Option<u64> {
        self.events.first().map(|event| event.cursor)
    }
}

fn sanitize_metadata(metadata: Map<String, Value>) -> Map<String, Value> {
    metadata
        .into_iter()
        .fold(Map::new(), |mut sanitized, (key, value)| {
            match value {
                Value::String(value) if raw_string_metadata_allowed(&key) => {
                    sanitized.insert(key, Value::from(value));
                }
                Value::String(value) => {
                    sanitized.insert(format!("{key}Length"), Value::from(value.chars().count()));
                }
                Value::Array(value) => {
                    sanitized.insert(format!("{key}Count"), Value::from(value.len() as u64));
                }
                Value::Object(value) => {
                    sanitized.insert(format!("{key}KeyCount"), Value::from(value.len() as u64));
                }
                Value::Bool(value) => {
                    sanitized.insert(key, Value::from(value));
                }
                Value::Number(value) => {
                    sanitized.insert(key, Value::Number(value));
                }
                Value::Null => {
                    sanitized.insert(key, Value::Null);
                }
            }
            sanitized
        })
}

fn raw_string_metadata_allowed(key: &str) -> bool {
    matches!(
        key,
        "assistantEventType"
            | "channel"
            | "eventType"
            | "firstArgumentType"
            | "messageId"
            | "payloadType"
            | "phase"
            | "role"
            | "signature"
            | "toolCallId"
            | "toolName"
    )
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn default_start_options() -> DiagnosticStartOptions {
    DiagnosticStartOptions {
        sources: Vec::new(),
        max_events: None,
        ttl_seconds: None,
        include_text: false,
    }
}

fn default_sources() -> BTreeSet<DiagnosticSource> {
    [DiagnosticSource::Sidecar, DiagnosticSource::Backend]
        .into_iter()
        .collect()
}

fn snippet(text: &str) -> String {
    let mut shortened = text
        .chars()
        .take(MAX_TEXT_SNIPPET_CHARS)
        .collect::<String>();
    if text.chars().count() > MAX_TEXT_SNIPPET_CHARS {
        shortened.push_str("...");
    }
    shortened
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(source: DiagnosticSource, text: Option<&str>) -> DiagnosticRecord {
        let record = DiagnosticRecord::new(source, DiagnosticLevel::Info, "diagnostic.test");
        if let Some(text) = text {
            record.with_text(text)
        } else {
            record
        }
    }

    #[test]
    fn diagnostics_start_stop_and_clear() {
        let mut diagnostics = Diagnostics::default();

        let status = diagnostics.start(None, 1_000).unwrap();
        assert!(status.enabled);
        assert_eq!(status.max_events, 500);
        assert!(!status.include_text);

        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_001));
        assert_eq!(diagnostics.status(1_002).event_count, 1);

        assert!(!diagnostics.stop(1_003).enabled);
        assert!(!diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_004));
        diagnostics.clear();
        assert_eq!(diagnostics.status(1_005).event_count, 0);
        assert_eq!(diagnostics.status(1_005).newest_cursor, 0);
    }

    #[test]
    fn diagnostics_rejects_malformed_options() {
        let mut diagnostics = Diagnostics::default();

        assert!(diagnostics
            .start(
                Some(DiagnosticStartOptions {
                    sources: vec![],
                    max_events: Some(0),
                    ttl_seconds: None,
                    include_text: false,
                }),
                1_000,
            )
            .unwrap_err()
            .contains("maxEvents"));
        assert!(diagnostics
            .start(
                Some(DiagnosticStartOptions {
                    sources: vec![],
                    max_events: None,
                    ttl_seconds: Some(0),
                    include_text: false,
                }),
                1_000,
            )
            .unwrap_err()
            .contains("ttlSeconds"));
        assert!(diagnostics
            .start(
                Some(DiagnosticStartOptions {
                    sources: vec![],
                    max_events: Some(MAX_ALLOWED_EVENTS + 1),
                    ttl_seconds: None,
                    include_text: false,
                }),
                1_000,
            )
            .unwrap_err()
            .contains("maxEvents"));
        assert!(diagnostics
            .start(
                Some(DiagnosticStartOptions {
                    sources: vec![],
                    max_events: None,
                    ttl_seconds: Some(MAX_TTL_SECONDS + 1),
                    include_text: false,
                }),
                1_000,
            )
            .unwrap_err()
            .contains("ttlSeconds"));
        diagnostics.start(None, 1_000).unwrap();
        assert!(diagnostics
            .read(
                Some(DiagnosticReadOptions {
                    cursor: None,
                    limit: Some(0),
                }),
                1_001,
            )
            .unwrap_err()
            .contains("limit"));
    }

    #[test]
    fn diagnostics_retains_max_events_and_reports_dropped_events() {
        let mut diagnostics = Diagnostics::default();
        diagnostics
            .start(
                Some(DiagnosticStartOptions {
                    sources: vec![DiagnosticSource::Sidecar],
                    max_events: Some(2),
                    ttl_seconds: Some(60),
                    include_text: false,
                }),
                1_000,
            )
            .unwrap();

        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_001));
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_002));
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_003));

        let response = diagnostics.read(None, 1_004).unwrap();
        assert_eq!(
            response
                .events
                .iter()
                .map(|event| event.cursor)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert_eq!(response.oldest_cursor, Some(2));
        assert_eq!(response.newest_cursor, 3);
        assert_eq!(response.dropped_events, 1);
    }

    #[test]
    fn diagnostics_reads_after_cursor_with_limit() {
        let mut diagnostics = Diagnostics::default();
        diagnostics.start(None, 1_000).unwrap();
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_001));
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_002));
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_003));

        let response = diagnostics
            .read(
                Some(DiagnosticReadOptions {
                    cursor: Some(1),
                    limit: Some(1),
                }),
                1_004,
            )
            .unwrap();

        assert_eq!(response.events.len(), 1);
        assert_eq!(response.events[0].cursor, 2);
        assert!(response.has_more);
    }

    #[test]
    fn diagnostics_read_without_cursor_returns_latest_tail() {
        let mut diagnostics = Diagnostics::default();
        diagnostics.start(None, 1_000).unwrap();
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_001));
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_002));
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_003));

        let response = diagnostics
            .read(
                Some(DiagnosticReadOptions {
                    cursor: None,
                    limit: Some(2),
                }),
                1_004,
            )
            .unwrap();

        assert_eq!(
            response
                .events
                .iter()
                .map(|event| event.cursor)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert!(!response.has_more);
    }

    #[test]
    fn diagnostics_filters_sources() {
        let mut diagnostics = Diagnostics::default();
        diagnostics
            .start(
                Some(DiagnosticStartOptions {
                    sources: vec![DiagnosticSource::Backend],
                    max_events: None,
                    ttl_seconds: None,
                    include_text: false,
                }),
                1_000,
            )
            .unwrap();

        assert!(!diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_001));
        assert!(diagnostics.record(record(DiagnosticSource::Backend, None), 1_002));
        assert_eq!(diagnostics.read(None, 1_003).unwrap().events.len(), 1);
    }

    #[test]
    fn diagnostics_expires_after_ttl() {
        let mut diagnostics = Diagnostics::default();
        diagnostics
            .start(
                Some(DiagnosticStartOptions {
                    sources: vec![],
                    max_events: None,
                    ttl_seconds: Some(1),
                    include_text: false,
                }),
                1_000,
            )
            .unwrap();

        assert!(diagnostics.status(1_999).enabled);
        assert!(!diagnostics.status(2_000).enabled);
        assert!(!diagnostics.record(record(DiagnosticSource::Sidecar, None), 2_001));
    }

    #[test]
    fn diagnostics_cursors_remain_monotonic_across_start_and_clear() {
        let mut diagnostics = Diagnostics::default();
        diagnostics.start(None, 1_000).unwrap();
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_001));
        diagnostics.clear();
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_002));
        diagnostics.start(None, 1_003).unwrap();
        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, None), 1_004));

        let response = diagnostics.read(None, 1_005).unwrap();

        assert_eq!(response.events.len(), 1);
        assert_eq!(response.events[0].cursor, 3);
    }

    #[test]
    fn diagnostics_redacts_text_by_default() {
        let mut diagnostics = Diagnostics::default();
        diagnostics.start(None, 1_000).unwrap();

        assert!(diagnostics.record(
            record(DiagnosticSource::Sidecar, Some("secret prompt text")),
            1_001,
        ));

        let event = diagnostics.read(None, 1_002).unwrap().events.remove(0);
        assert_eq!(event.metadata.get("textLength"), Some(&json!(18)));
        assert_eq!(event.metadata.get("textSnippet"), None);
    }

    #[test]
    fn diagnostics_include_text_stores_bounded_snippet() {
        let mut diagnostics = Diagnostics::default();
        diagnostics
            .start(
                Some(DiagnosticStartOptions {
                    sources: vec![],
                    max_events: None,
                    ttl_seconds: None,
                    include_text: true,
                }),
                1_000,
            )
            .unwrap();
        let text = "a".repeat(MAX_TEXT_SNIPPET_CHARS + 10);

        assert!(diagnostics.record(record(DiagnosticSource::Sidecar, Some(&text)), 1_001));

        let event = diagnostics.read(None, 1_002).unwrap().events.remove(0);
        let expected = format!("{}...", "a".repeat(MAX_TEXT_SNIPPET_CHARS));
        assert_eq!(
            event.metadata.get("textSnippet").and_then(Value::as_str),
            Some(expected.as_str())
        );
    }

    #[test]
    fn diagnostics_sanitizes_unclassified_string_metadata_at_boundary() {
        let mut diagnostics = Diagnostics::default();
        diagnostics.start(None, 1_000).unwrap();

        assert!(diagnostics.record(
            DiagnosticRecord::new(
                DiagnosticSource::Backend,
                DiagnosticLevel::Warn,
                "diagnostic.safe_metadata",
            )
            .with_safe_string("eventType", "text_delta")
            .with_safe_string("rawPrompt", "secret prompt text")
            .with_value("rawObject", json!({ "secret": "hidden" }))
            .with_u64("textLength", 42)
            .with_bool("forwarded", true)
            .with_text("raw assistant text"),
            1_001,
        ));

        let event = diagnostics.read(None, 1_002).unwrap().events.remove(0);

        assert_eq!(event.metadata.get("eventType"), Some(&json!("text_delta")));
        assert_eq!(event.metadata.get("rawPrompt"), None);
        assert_eq!(event.metadata.get("rawPromptLength"), Some(&json!(18)));
        assert_eq!(event.metadata.get("rawObject"), None);
        assert_eq!(event.metadata.get("rawObjectKeyCount"), Some(&json!(1)));
        assert_eq!(event.metadata.get("textLength"), Some(&json!(18)));
        assert_eq!(event.metadata.get("textSnippet"), None);
        assert_eq!(event.metadata.get("forwarded"), Some(&json!(true)));
    }
}
