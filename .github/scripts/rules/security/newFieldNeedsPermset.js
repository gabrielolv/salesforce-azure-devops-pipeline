// SF-SEC-002 — New custom field without a permission set update
export default function newFieldNeedsPermset(files) {
  const findings = [];

  const newFields = files.filter(
    f => f.status === 'added' &&
         f.filename.includes('/fields/') &&
         f.filename.endsWith('.field-meta.xml')
  );

  if (newFields.length === 0) return [];

  const hasPermsetChange = files.some(
    f => f.filename.includes('/permissionsets/') &&
         f.filename.endsWith('.permissionset-meta.xml') &&
         f.status !== 'removed'
  );

  if (hasPermsetChange) return [];

  for (const f of newFields) {
    findings.push({
      ruleId: 'SF-SEC-002',
      severity: 'warning',
      path: f.filename,
      startLine: 1,
      endLine: 1,
      message: 'New custom field added but no Permission Set was updated in this PR.',
      suggestion: 'Grant field-level access explicitly in a Permission Set so the field is visible to the intended users.',
    });
  }

  return findings;
}
