// SF-SEC-001 — Profile changes: prefer Permission Sets
export default function preferPermissionSets(files) {
  const profileFiles = files.filter(
    f => f.filename.includes('/profiles/') && f.filename.endsWith('.profile-meta.xml') && f.status !== 'removed'
  );

  return profileFiles.map(f => ({
    ruleId: 'SF-SEC-001',
    severity: 'warning',
    path: f.filename,
    startLine: 1,
    endLine: 1,
    message: 'Profile metadata modified. Salesforce security guidance recommends managing access through Permission Sets rather than Profiles.',
    suggestion: 'Evaluate whether the access change can be delivered via a Permission Set instead. Profile changes are harder to audit and migrate.',
  }));
}
