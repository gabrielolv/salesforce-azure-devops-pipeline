#!/bin/bash
# Generates a Vlocity Build Tool job YAML file from a component manifest.
# Usage: vlocity-build-jobfile.sh <manifest-file> <output-job-file>
#
# The manifest file must contain one component per line in TYPE/ComponentName format,
# sorted alphabetically (components of the same type must be contiguous).

set -euo pipefail

MANIFEST_FILE="${1:-delta/vlocity/deploy-manifest.txt}"
JOB_FILE="${2:-delta/vlocity/vlocity-deploy-job.yaml}"
VLOCITY_ROOT="${VLOCITY_ROOT:-vlocity}"

if [ ! -s "$MANIFEST_FILE" ]; then
  echo "Manifest '$MANIFEST_FILE' is empty — no job file generated."
  exit 0
fi

{
  echo "projectPath: ./${VLOCITY_ROOT}"
  echo "expansionPath: ./${VLOCITY_ROOT}"
  echo "maxDepth: -1"
  echo "continueAfterError: false"
  echo "defaultMaxParallel: 1"
  echo "activate: true"
  echo "manifest:"

  CURRENT_TYPE=""
  while IFS='/' read -r TYPE COMPONENT; do
    if [ "$TYPE" != "$CURRENT_TYPE" ]; then
      echo "  ${TYPE}:"
      CURRENT_TYPE="$TYPE"
    fi
    echo "    - ${COMPONENT}"
  done < "$MANIFEST_FILE"
} > "$JOB_FILE"

echo "Job file written to $JOB_FILE:"
cat "$JOB_FILE"
