// SF-APEX-003 — Trigger/helper logic must support bulk operations
export default function bulkifiedLogic(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;

    const isTrigger = file.filename.endsWith('.trigger');
    const isHelper  = /[Hh]andler|[Hh]elper|[Ss]ervice/.test(file.filename) && file.filename.endsWith('.cls');

    if (!isTrigger && !isHelper) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/Trigger\.(new|old)\s*\[\s*0\s*\]/.test(trimmed)) {
        findings.push({
          ruleId: 'SF-APEX-003',
          severity: 'warning',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: 'Single-record index pattern (Trigger.new[0]) detected. Triggers must handle bulk operations.',
          suggestion: 'Iterate over Trigger.new / Trigger.old using a for-each loop instead of accessing index 0.',
        });
      }
    }
  }

  return findings;
}
