use serde_json::Value;

const MAX_DEV_LOG_TEXT_CHARS: usize = 240;

fn quote_dev_log_text(text: &str) -> String {
    let single_line = text.replace('\n', "\\n").replace('\r', "\\r");
    let mut shortened = single_line
        .chars()
        .take(MAX_DEV_LOG_TEXT_CHARS)
        .collect::<String>();
    if single_line.chars().count() > MAX_DEV_LOG_TEXT_CHARS {
        shortened.push_str("...");
    }
    serde_json::to_string(&shortened).unwrap_or_else(|_| "\"<unprintable>\"".into())
}

fn text_from_content(content: Option<&Value>) -> Option<String> {
    let text = content?
        .as_array()?
        .iter()
        .filter_map(|part| {
            if part.get("type").and_then(Value::as_str) == Some("text") {
                part.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .collect::<String>();

    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn format_usage(message: &Value) -> String {
    let Some(usage) = message.get("usage") else {
        return String::new();
    };

    let mut parts = Vec::new();
    if let Some(tokens) = usage.get("totalTokens").and_then(Value::as_u64) {
        parts.push(format!("tokens={tokens}"));
    }
    if let Some(total_cost) = usage
        .get("cost")
        .and_then(|cost| cost.get("total"))
        .and_then(Value::as_f64)
    {
        parts.push(format!("cost={total_cost:.6}"));
    }

    if parts.is_empty() {
        String::new()
    } else {
        format!(" {}", parts.join(" "))
    }
}

fn format_session_dev_event(event: &Value) -> Option<String> {
    let event_type = event.get("type").and_then(Value::as_str)?;

    match event_type {
        "agent_start" | "turn_start" => Some(event_type.to_string()),
        "agent_end" => {
            let message_count = event
                .get("messages")
                .and_then(Value::as_array)
                .map_or(0, std::vec::Vec::len);
            Some(format!("agent_end messages={message_count}"))
        }
        "turn_end" => {
            let tool_result_count = event
                .get("toolResults")
                .and_then(Value::as_array)
                .map_or(0, std::vec::Vec::len);
            Some(format!("turn_end toolResults={tool_result_count}"))
        }
        "message_start" => {
            let message = event.get("message")?;
            let role = message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            if role == "assistant" {
                let model = message
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-model");
                Some(format!("assistant_start model={model}"))
            } else {
                Some(format!("{role}_start"))
            }
        }
        "message_end" => {
            let message = event.get("message")?;
            let role = message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let text = text_from_content(message.get("content"))
                .map(|text| format!(" {}", quote_dev_log_text(&text)))
                .unwrap_or_default();
            let usage = if role == "assistant" {
                format_usage(message)
            } else {
                String::new()
            };
            Some(format!("{role}_final{text}{usage}"))
        }
        "message_update" => {
            let assistant_event = event.get("assistantMessageEvent")?;
            let assistant_event_type = assistant_event.get("type").and_then(Value::as_str)?;
            match assistant_event_type {
                "text_delta" => {
                    let delta = assistant_event
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    Some(format!("assistant_delta {}", quote_dev_log_text(delta)))
                }
                "text_start" => Some("assistant_text_start".into()),
                "text_end" => Some("assistant_text_end".into()),
                other => Some(format!("assistant_event {other}")),
            }
        }
        "tool_execution_start" => {
            let name = event
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            Some(format!("tool_start {name}"))
        }
        "tool_execution_end" => {
            let name = event
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let ok = !event
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Some(format!("tool_end {name} ok={ok}"))
        }
        other => Some(format!("session_event {other}")),
    }
}

pub(crate) fn format_sidecar_dev_log(value: &Value) -> Option<String> {
    match value.get("type").and_then(Value::as_str)? {
        "project_state" => {
            let phase = value
                .get("phase")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let brief = value.get("brief").and_then(Value::as_bool).unwrap_or(false);
            let prd_count = value
                .get("prds")
                .and_then(Value::as_array)
                .map_or(0, std::vec::Vec::len);
            let issue_count = value
                .get("issues")
                .and_then(Value::as_array)
                .map_or(0, std::vec::Vec::len);
            Some(format!(
                "project_state phase={phase} brief={brief} prds={prd_count} issues={issue_count}"
            ))
        }
        "session_event" => format_session_dev_event(value.get("event")?),
        "tool_start" => {
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            Some(format!("tool_start {name}"))
        }
        "tool_end" => {
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
            Some(format!("tool_end {name} ok={ok}"))
        }
        "assistant_error" => {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown assistant error");
            Some(format!("assistant_error {}", quote_dev_log_text(message)))
        }
        other => Some(format!("{other} {value}")),
    }
}
