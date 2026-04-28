#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_FILE="$ROOT_DIR/prompts/ralph-loop.md"
SCHEMA_FILE="$ROOT_DIR/prompts/ralph-result.schema.json"
BASE_BRANCH="${BASE_BRANCH:-main}"
MAX_ITERS="${MAX_ITERS:-100}"
USE_BYPASS="${RALPH_BYPASS_SANDBOX:-0}"
CODEX_MODEL="${CODEX_MODEL:-}"
EXTRA_PROMPT_FILE="${RALPH_EXTRA_PROMPT_FILE:-}"
CODEX_SANDBOX_MODE="${RALPH_SANDBOX:-workspace-write}"
WORKTREE_ROOT="${RALPH_WORKTREE_ROOT:-$(cd "$ROOT_DIR/.." && pwd)/$(basename "$ROOT_DIR")-ralph}"
TMP_ROOT="$WORKTREE_ROOT/.tmp"
OPERATOR_PROMPT="${*:-}"
SANDBOX_CMD=(docker sandbox run codex)

ACTIVE_ISSUE_NUMBER=""
ACTIVE_ISSUE_TITLE=""
ACTIVE_ISSUE_BODY=""
ACTIVE_BRANCH=""
ACTIVE_WORKTREE=""
ACTIVE_MODE=""
ACTIVE_PR_NUMBER=""

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

slugify() {
  local input="$1"
  local slug

  slug="$(printf '%s' "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  slug="${slug:0:48}"
  slug="${slug%-}"

  if [[ -z "$slug" ]]; then
    slug="untitled"
  fi

  printf '%s\n' "$slug"
}

json_field() {
  local encoded="$1"
  local query="$2"
  printf '%s' "$encoded" | jq -r "$query"
}

sync_control_repo() {
  git -C "$ROOT_DIR" fetch origin --prune
}

is_open_issue_number() {
  local issue_number="$1"
  grep -q "^${issue_number}$" "$OPEN_ISSUE_NUMBERS_FILE"
}

issue_is_blocked() {
  local body="$1"
  local blocked

  blocked="$(
    printf '%s\n' "$body" \
      | grep -Eio 'blocked by #[0-9]+' \
      | grep -Eo '[0-9]+' \
      || true
  )"

  if [[ -z "$blocked" ]]; then
    return 1
  fi

  while IFS= read -r dependency; do
    [[ -z "$dependency" ]] && continue
    if is_open_issue_number "$dependency"; then
      return 0
    fi
  done <<<"$blocked"

  return 1
}

load_issue_by_number() {
  local issue_number="$1"
  local encoded

  encoded="$(
    jq -c --argjson issue "$issue_number" '.[] | select(.number == $issue)' \
      "$OPEN_ISSUES_JSON" \
      | head -n 1
  )"

  if [[ -z "$encoded" ]]; then
    return 1
  fi

  ACTIVE_ISSUE_NUMBER="$issue_number"
  ACTIVE_ISSUE_TITLE="$(json_field "$encoded" '.title')"
  ACTIVE_ISSUE_BODY="$(json_field "$encoded" '(.body // "")')"
  return 0
}

select_issue_context() {
  OPEN_ISSUES_JSON="$(mktemp "$TMP_ROOT/issues.XXXXXX")"
  OPEN_PRS_JSON="$(mktemp "$TMP_ROOT/prs.XXXXXX")"
  OPEN_ISSUE_NUMBERS_FILE="$(mktemp "$TMP_ROOT/open-issues.XXXXXX")"

  gh issue list --repo "$REPO" --state open --limit 200 --json number,title,body,url >"$OPEN_ISSUES_JSON"
  gh pr list --repo "$REPO" --state open --limit 200 --json number,headRefName,title,url >"$OPEN_PRS_JSON"
  jq -r '.[].number' "$OPEN_ISSUES_JSON" | sort -n >"$OPEN_ISSUE_NUMBERS_FILE"

  if [[ ! -s "$OPEN_ISSUE_NUMBERS_FILE" ]]; then
    ACTIVE_MODE="no_open_issues"
    return 0
  fi

  local encoded branch issue_number
  while IFS= read -r encoded; do
    branch="$(json_field "$encoded" '.headRefName')"
    if [[ "$branch" =~ ^issue-([0-9]+)- ]]; then
      issue_number="${BASH_REMATCH[1]}"
      if load_issue_by_number "$issue_number"; then
        ACTIVE_BRANCH="$branch"
        ACTIVE_PR_NUMBER="$(json_field "$encoded" '.number')"
        ACTIVE_MODE="resume"
        return 0
      fi
    fi
  done < <(jq -c '.[]' "$OPEN_PRS_JSON")

  while IFS= read -r encoded; do
    issue_number="$(json_field "$encoded" '.number')"
    ACTIVE_ISSUE_TITLE="$(json_field "$encoded" '.title')"
    ACTIVE_ISSUE_BODY="$(json_field "$encoded" '(.body // "")')"

    if issue_is_blocked "$ACTIVE_ISSUE_BODY"; then
      continue
    fi

    ACTIVE_ISSUE_NUMBER="$issue_number"
    ACTIVE_BRANCH="issue-${issue_number}-$(slugify "$ACTIVE_ISSUE_TITLE")"
    ACTIVE_MODE="new"
    ACTIVE_PR_NUMBER=""
    return 0
  done < <(jq -c 'sort_by(.number)[]' "$OPEN_ISSUES_JSON")

  ACTIVE_MODE="no_ready_issues"
  return 0
}

ensure_worktree() {
  ACTIVE_WORKTREE="$WORKTREE_ROOT/$ACTIVE_BRANCH"

  if [[ -d "$ACTIVE_WORKTREE" ]] && git -C "$ACTIVE_WORKTREE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  if [[ -e "$ACTIVE_WORKTREE" ]]; then
    echo "Worktree path exists but is not a git worktree: $ACTIVE_WORKTREE" >&2
    exit 1
  fi

  if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/heads/$ACTIVE_BRANCH"; then
    git -C "$ROOT_DIR" worktree add "$ACTIVE_WORKTREE" "$ACTIVE_BRANCH"
    return 0
  fi

  if git -C "$ROOT_DIR" ls-remote --exit-code --heads origin "$ACTIVE_BRANCH" >/dev/null 2>&1; then
    git -C "$ROOT_DIR" fetch origin "$ACTIVE_BRANCH:$ACTIVE_BRANCH"
    git -C "$ROOT_DIR" worktree add "$ACTIVE_WORKTREE" "$ACTIVE_BRANCH"
    return 0
  fi

  git -C "$ROOT_DIR" worktree add -b "$ACTIVE_BRANCH" "$ACTIVE_WORKTREE" "origin/$BASE_BRANCH"
}

build_sandbox_name() {
  local slug
  slug="$(slugify "$ACTIVE_ISSUE_TITLE")"
  slug="${slug:0:18}"
  printf 'ralph-%s-%s\n' "$ACTIVE_ISSUE_NUMBER" "$slug"
}

build_prompt() {
  local prompt_path="$1"

  {
    cat "$PROMPT_FILE"
    printf '\n\nRepository: `%s`\n' "$REPO"
    printf 'Base branch: `%s`\n' "$BASE_BRANCH"
    printf 'Assigned issue: `#%s`\n' "$ACTIVE_ISSUE_NUMBER"
    printf 'Assigned branch: `%s`\n' "$ACTIVE_BRANCH"
    printf 'Assigned worktree: `%s`\n' "$ACTIVE_WORKTREE"
    printf 'Assignment mode: `%s`\n' "$ACTIVE_MODE"
    if [[ -n "$ACTIVE_PR_NUMBER" ]]; then
      printf 'Existing PR: `#%s`\n' "$ACTIVE_PR_NUMBER"
    fi
    printf '\nIssue title: %s\n' "$ACTIVE_ISSUE_TITLE"
    printf '\nIssue body:\n\n```md\n%s\n```\n' "$ACTIVE_ISSUE_BODY"
    if [[ -n "$OPERATOR_PROMPT" ]]; then
      printf '\nOperator instructions: %s\n' "$OPERATOR_PROMPT"
    fi
    if [[ -n "$EXTRA_PROMPT_FILE" ]]; then
      printf '\nAdditional operator instructions:\n\n'
      cat "$EXTRA_PROMPT_FILE"
    fi
  } >"$prompt_path"
}

run_codex_iteration() {
  local run_dir prompt_path result_path
  run_dir="$(mktemp -d "$TMP_ROOT/ralph.XXXXXX")"
  prompt_path="$run_dir/prompt.md"
  result_path="$run_dir/result.json"
  build_prompt "$prompt_path"

  local -a codex_args
  codex_args=()

  if [[ "$USE_BYPASS" == "1" ]]; then
    codex_args+=(--dangerously-bypass-approvals-and-sandbox)
  else
    codex_args+=(--ask-for-approval never)
  fi

  codex_args+=(
    exec
    --cd "$ACTIVE_WORKTREE"
    --add-dir "$ROOT_DIR/.git"
    --output-schema "$SCHEMA_FILE"
    --output-last-message "$result_path"
    --sandbox "$CODEX_SANDBOX_MODE"
  )

  if [[ -n "$CODEX_MODEL" ]]; then
    codex_args+=(--model "$CODEX_MODEL")
  fi

  echo "=== Ralph iteration $ITERATION ==="
  echo "Issue: #$ACTIVE_ISSUE_NUMBER"
  echo "Branch: $ACTIVE_BRANCH"
  echo "Worktree: $ACTIVE_WORKTREE"

  local sandbox_name
  sandbox_name="$(build_sandbox_name)"

  if ! "${SANDBOX_CMD[@]}" --name "$sandbox_name" "$ACTIVE_WORKTREE" -- "${codex_args[@]}" - <"$prompt_path"; then
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

cleanup_finished_worktree() {
  case "${1:-}" in
    merged|closed_issue)
      if [[ -d "$ACTIVE_WORKTREE" ]]; then
        git -C "$ROOT_DIR" worktree remove "$ACTIVE_WORKTREE" || true
      fi
      ;;
  esac
}

require_cmd git
require_cmd gh
require_cmd jq
require_cmd docker

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

mkdir -p "$WORKTREE_ROOT" "$TMP_ROOT"

if [[ "$MAX_ITERS" -lt 1 ]]; then
  echo "MAX_ITERS must be at least 1." >&2
  exit 1
fi

for ((ITERATION = 1; ITERATION <= MAX_ITERS; ITERATION++)); do
  sync_control_repo
  select_issue_context

  case "$ACTIVE_MODE" in
    no_open_issues)
      echo "No open issues remain."
      exit 0
      ;;
    no_ready_issues)
      echo "Open issues remain, but all are blocked."
      exit 0
      ;;
  esac

  ensure_worktree

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

  cleanup_finished_worktree "$outcome"

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
