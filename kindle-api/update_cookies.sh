#!/usr/bin/env bash

set -euo pipefail

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

main() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  local cookie_file="${1:-"$script_dir/cookie.txt"}"
  local env_file="${2:-"$script_dir/.env"}"

  if [[ ! -f "$cookie_file" ]]; then
    echo "Cookie file not found: $cookie_file" >&2
    exit 1
  fi

  if [[ ! -f "$env_file" ]]; then
    echo ".env file not found: $env_file" >&2
    exit 1
  fi

  local cookie
  cookie="$(tr -d $'\r\n' < "$cookie_file")"

  local at_main=""
  local session_id=""
  local ubid_main=""
  local x_main=""

  local -a parts=()
  IFS=';' read -r -a parts <<< "$cookie"

  local part trimmed name value
  for part in "${parts[@]}"; do
    trimmed="$(trim "$part")"
    [[ "$trimmed" == *=* ]] || continue

    name="${trimmed%%=*}"
    value="${trimmed#*=}"

    case "$name" in
      at-main) at_main="$value" ;;
      session-id) session_id="$value" ;;
      ubid-main) ubid_main="$value" ;;
      x-main) x_main="$value" ;;
    esac
  done

  local -a missing=()
  [[ -n "$at_main" ]] || missing+=("at-main")
  [[ -n "$session_id" ]] || missing+=("session-id")
  [[ -n "$ubid_main" ]] || missing+=("ubid-main")
  [[ -n "$x_main" ]] || missing+=("x-main")

  if (( ${#missing[@]} > 0 )); then
    echo "Missing cookie keys: ${missing[*]}" >&2
    exit 1
  fi

  local cookies_line="at-main=$at_main; session-id=$session_id; ubid-main=$ubid_main; x-main=$x_main"
  local escaped_cookies_line
  escaped_cookies_line="$(printf '%s' "$cookies_line" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  local new_entry="COOKIES=\"$escaped_cookies_line\""

  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT

  local found=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ $found -eq 0 && "$line" == COOKIES=* ]]; then
      printf '%s\n' "$new_entry" >> "$tmp"
      found=1
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$env_file"

  if [[ $found -eq 0 ]]; then
    printf '%s\n' "$new_entry" >> "$tmp"
  fi

  mv "$tmp" "$env_file"
  trap - EXIT

  echo "Updated COOKIES entry in $env_file"
}

main "$@"
