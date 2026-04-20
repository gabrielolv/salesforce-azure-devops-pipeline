// SF-META-002 — Destructive or rename-risk metadata changes
const DESTRUCTIVE_PATTERNS = [
  /destructiveChanges.*\.xml$/i,
  /destructiveChangesPre.*\.xml$/i,
  /destructiveChangesPost.*\.xml$/i,
];

export default function destructiveChanges(files) {
  const findings = [];

  for (const file of files) {
    // Explicit destructive manifests
    if (DESTRUCTIVE_PATTERNS.some(p => p.test(file.filename))) {
      findings.push({
        ruleId: 'SF-META-002',
        severity: 'warning',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: 'Destructive change manifest detected. Deletions are irreversible in production.',
        suggestion: 'Confirm the components being removed are unused across all orgs. Plan a rollback path before deploying.',
      });
      continue;
    }

    // Removed metadata files
    if (file.status === 'removed') {
      const ext = file.filename.split('.').slice(1).join('.');
      if (ext.endsWith('-meta.xml') || file.filename.endsWith('.cls') || file.filename.endsWith('.trigger')) {
        findings.push({
          ruleId: 'SF-META-002',
          severity: 'warning',
          path: file.filename,
          startLine: 1,
          endLine: 1,
          message: `Metadata file removed from source: ${file.filename.split('/').pop()}.`,
          suggestion: 'Add a destructiveChanges.xml entry if the component should be deleted from the org. Verify no other components reference it.',
        });
      }
    }

    // Renamed files (GitHub reports as removed + added)
    if (file.status === 'renamed') {
      findings.push({
        ruleId: 'SF-META-002',
        severity: 'warning',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: `Metadata component renamed: ${file.previous_filename} → ${file.filename}. Salesforce does not rename — the old component must be explicitly deleted.`,
        suggestion: 'Include a destructiveChanges.xml to remove the old API name, otherwise both names will exist in the org.',
      });
    }
  }

  return findings;
}
