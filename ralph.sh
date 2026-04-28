#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_FILE="$ROOT_DIR/prompts/ralph-loop.md"
SCHEMA_FILE="$ROOT_DIR/prompts/ralph-result.schema.json"
BASE_BRANCH="${BASE_BRANCH:-main}"
MAX_ITERS="${MAX_ITERS:-100}"
ALLOW_DIRTY="${RALPH_ALLOW_DIRTY:-0}"
USE_BYPASS="${RALPH_BYPASS_SANDBOX:-0}"
CODEX_MODEL="${CODEX_MODEL:-}"
EXTRA_PROMPT_FILE="${RALPH_EXTRA_PROMPT_FILE:-}"
OPERATOR_PROMPT="${*:-}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

infer_repo() {
  local remote
  remote="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"

  if [[ -z "$remote" ]]; then
    echo ""
    return
  fi

  remote="${remote%.git}"
  remote="${remote#git@github.com:}"
  remote="${remote#https://github.com/}"
  remote="${remote#http://github.com/}"
  echo "$remote"
}

build_prompt() {
  local prompt_path="$1"

  {
    cat "$PROMPT_FILE"
    printf '\n\nRepository: `%s`\n' "$REPO"
    printf 'Base branch: `%s`\n' "$BASE_BRANCH"
    printf 'Working directory: `%s`\n' "$ROOT_DIR"
    if [[ -n "$OPERATOR_PROMPT" ]]; then
      printf '\nOperator instructions: %s\n' "$OPERATOR_PROMPT"
    fi
    if [[ -n "$EXTRA_PROMPT_FILE" ]]; then
      printf '\nAdditional operator instructions:\n\n'
      cat "$EXTRA_PROMPT_FILE"
    fi
  } >"$prompt_path"
}

require_clean_tree() {
  local status
  status="$(git -C "$ROOT_DIR" status --short)"
  if [[ -n "$status" && "$ALLOW_DIRTY" != "1" ]]; then
    echo "Refusing to run with a dirty worktree. Commit/stash changes or set RALPH_ALLOW_DIRTY=1." >&2
    echo "$status" >&2
    exit 1
  fi
}

run_codex_iteration() {
  local run_dir prompt_path result_path
  run_dir="$(mktemp -d "${TMPDIR:-/tmp}/ralph.XXXXXX")"
  prompt_path="$run_dir/prompt.md"
  result_path="$run_dir/result.json"
  build_prompt "$prompt_path"

  local -a args
  args=(exec --cd "$ROOT_DIR" --output-schema "$SCHEMA_FILE" --output-last-message "$result_path")

  if [[ -n "$CODEX_MODEL" ]]; then
    args+=(--model "$CODEX_MODEL")
  fi

  if [[ "$USE_BYPASS" == "1" ]]; then
    args+=(--dangerously-bypass-approvals-and-sandbox)
  else
    args+=(--ask-for-approval never --sandbox danger-full-access)
  fi

  echo "=== Ralph iteration $ITERATION ==="
  if ! codex "${args[@]}" - <"$prompt_path"; then
    echo "Codex exited non-zero on iteration $ITERATION." >&2
    return 1
  fi

  if [[ ! -s "$result_path" ]]; then
    echo "Codex did not write a result payload on iteration $ITERATION." >&2
    return 1
  fi

  RESULT_PATH="$result_path"
  return 0
}

require_cmd git
require_cmd gh
require_cmd jq
require_cmd codex

if ! git -C "$ROOT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "ralph.sh must run inside a git repository." >&2
  exit 1
fi

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Missing prompt file: $PROMPT_FILE" >&2
  exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "Missing schema file: $SCHEMA_FILE" >&2
  exit 1
fi

REPO="${RALPH_REPO:-$(infer_repo)}"
if [[ -z "$REPO" ]]; then
  echo "Could not infer GitHub repo from origin. Set RALPH_REPO=owner/name." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated." >&2
  exit 1
fi

require_clean_tree

if [[ "$MAX_ITERS" -lt 1 ]]; then
  echo "MAX_ITERS must be at least 1." >&2
  exit 1
fi

for ((ITERATION = 1; ITERATION <= MAX_ITERS; ITERATION++)); do
  RESULT_PATH=""
  run_codex_iteration

  outcome="$(jq -r '.outcome' "$RESULT_PATH")"
  issue_number="$(jq -r '.issue_number // empty' "$RESULT_PATH")"
  pr_number="$(jq -r '.pr_number // empty' "$RESULT_PATH")"
  branch_name="$(jq -r '.branch // empty' "$RESULT_PATH")"
  summary="$(jq -r '.summary' "$RESULT_PATH")"

  echo "Outcome: $outcome"
  [[ -n "$issue_number" ]] && echo "Issue: #$issue_number"
  [[ -n "$pr_number" ]] && echo "PR: #$pr_number"
  [[ -n "$branch_name" ]] && echo "Branch: $branch_name"
  echo "Summary: $summary"

  case "$outcome" in
    merged|closed_issue)
      continue
      ;;
    no_open_issues|no_ready_issues)
      exit 0
      ;;
    blocked|needs_human|error)
      exit 1
      ;;
    *)
      echo "Unknown Ralph outcome: $outcome" >&2
      exit 1
      ;;
  esac
done

echo "Reached MAX_ITERS=$MAX_ITERS before the queue emptied." >&2
exit 1
