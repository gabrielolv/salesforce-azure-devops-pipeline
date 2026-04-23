#!/bin/bash
# Detects changed Vlocity datapack component directories between COMMIT_HASH and HEAD.
# Writes two manifests to delta/vlocity/:
#   deploy-manifest.txt  — added/modified components (TYPE/ComponentName, one per line)
#   delete-manifest.txt  — deleted components
#
# Reads COMMIT_HASH and VLOCITY_ROOT from the environment.

set -euo pipefail

VLOCITY_ROOT="${VLOCITY_ROOT:-vlocity}"
DELTA_DIR="delta/vlocity"
FROM_COMMIT="${COMMIT_HASH:-}"

mkdir -p "$DELTA_DIR"

if [ ! -d "$VLOCITY_ROOT" ]; then
  echo "Vlocity directory '$VLOCITY_ROOT' not found — skipping Vlocity delta."
  touch "$DELTA_DIR/deploy-manifest.txt" "$DELTA_DIR/delete-manifest.txt"
  exit 0
fi

if [ -z "$FROM_COMMIT" ]; then
  echo "No COMMIT_HASH set — treating all Vlocity components as changed (first-run mode)."
  find "$VLOCITY_ROOT" -mindepth 2 -maxdepth 2 -type d \
    | sed "s|^${VLOCITY_ROOT}/||" \
    | sort > "$DELTA_DIR/deploy-manifest.txt"
  touch "$DELTA_DIR/delete-manifest.txt"
else
  TMP_DEPLOY=$(mktemp)
  TMP_DELETE=$(mktemp)
  trap 'rm -f "$TMP_DEPLOY" "$TMP_DELETE"' EXIT

  # Each changed file maps to a component directory two levels deep: TYPE/ComponentName
  git diff --name-status "$FROM_COMMIT" HEAD -- "$VLOCITY_ROOT/" \
  | while IFS=$'\t' read -r STATUS FILE; do
    RELATIVE="${FILE#${VLOCITY_ROOT}/}"
    COMPONENT=$(echo "$RELATIVE" | awk -F'/' 'NF>=2{print $1"/"$2}')
    [ -z "$COMPONENT" ] && continue
    if [ "$STATUS" = "D" ]; then
      echo "$COMPONENT" >> "$TMP_DELETE"
    else
      echo "$COMPONENT" >> "$TMP_DEPLOY"
    fi
  done

  sort -u "$TMP_DEPLOY" > "$DELTA_DIR/deploy-manifest.txt"
  # Exclude from deletes anything that also appears in deploy (handles moves/renames)
  comm -23 <(sort -u "$TMP_DELETE") "$DELTA_DIR/deploy-manifest.txt" \
    > "$DELTA_DIR/delete-manifest.txt"
fi

DEPLOY_COUNT=$(grep -c . "$DELTA_DIR/deploy-manifest.txt" 2>/dev/null || echo 0)
DELETE_COUNT=$(grep -c . "$DELTA_DIR/delete-manifest.txt" 2>/dev/null || echo 0)

echo "Vlocity delta: $DEPLOY_COUNT to deploy, $DELETE_COUNT to delete"

if [ "$DEPLOY_COUNT" -gt 0 ]; then
  echo "Components to deploy:"
  cat "$DELTA_DIR/deploy-manifest.txt"
fi

if [ "$DELETE_COUNT" -gt 0 ]; then
  echo "Components to delete:"
  cat "$DELTA_DIR/delete-manifest.txt"
fi
