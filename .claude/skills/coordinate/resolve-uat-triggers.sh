#!/usr/bin/env bash
set -euo pipefail

map_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/uat-trigger-map.tsv"
matches=()

while IFS= read -r changed_path || [[ -n "$changed_path" ]]; do
  [[ -z "$changed_path" ]] && continue
  while IFS=$'\t' read -r mode path_glob spec; do
    [[ -z "$mode" || "$mode" == \#* ]] && continue
    case "$mode" in
      blocking | advisory) ;;
      *)
        echo "invalid UAT gate mode '$mode' in $map_file" >&2
        exit 2
        ;;
    esac

    # #1027/#1000: Bash glob matching keeps lookup dependency-free; mode comes from data so
    # runtime rows block while future non-runtime rows can remain advisory without code changes.
    if [[ "$changed_path" == $path_glob ]]; then
      matches+=("$mode"$'\t'"$spec")
    fi
  done <"$map_file"
done

if ((${#matches[@]})); then
  printf '%s\n' "${matches[@]}" | LC_ALL=C sort -u
fi
