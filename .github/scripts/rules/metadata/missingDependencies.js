// SF-META-001 — Likely missing related metadata
export default function missingDependencies(files) {
  const findings = [];
  const filenames = files.map(f => f.filename);

  const hasPath = (pattern) => filenames.some(f => pattern.test(f));

  // New field → no layout update
  const newFields = files.filter(
    f => f.status === 'added' && f.filename.includes('/fields/') && f.filename.endsWith('.field-meta.xml')
  );
  if (newFields.length > 0 && !hasPath(/\/layouts\//)) {
    findings.push({
      ruleId: 'SF-META-001',
      severity: 'warning',
      path: newFields[0].filename,
      startLine: 1,
      endLine: 1,
      message: `${newFields.length} new field(s) added but no page layout updated in this PR.`,
      suggestion: 'Add the new field(s) to the appropriate page layout(s) so they are visible on record pages.',
    });
  }

  // New tab → no app update
  const newTabs = files.filter(
    f => f.status === 'added' && f.filename.endsWith('.tab-meta.xml')
  );
  if (newTabs.length > 0 && !hasPath(/\/applications\//)) {
    findings.push({
      ruleId: 'SF-META-001',
      severity: 'notice',
      path: newTabs[0].filename,
      startLine: 1,
      endLine: 1,
      message: 'New custom tab added but no App metadata was updated.',
      suggestion: 'Add the tab to the relevant Lightning App so it appears in the navigation bar.',
    });
  }

  // New Apex class → no permission set granting Apex access
  const newApex = files.filter(
    f => f.status === 'added' && f.filename.endsWith('.cls') && !/(Test|_test)\.cls$/i.test(f.filename)
  );
  if (newApex.length > 0 && !hasPath(/\/permissionsets\//)) {
    findings.push({
      ruleId: 'SF-META-001',
      severity: 'notice',
      path: newApex[0].filename,
      startLine: 1,
      endLine: 1,
      message: 'New Apex class added but no Permission Set was updated with Apex class access.',
      suggestion: 'If this class is used by Lightning components or external callers, grant class access in the relevant Permission Set.',
    });
  }

  // New object → no tab / record page
  const newObjects = files.filter(
    f => f.status === 'added' && f.filename.endsWith('.object-meta.xml')
  );
  if (newObjects.length > 0 && !hasPath(/\/tabs\//) && !hasPath(/\/flexipages\//)) {
    findings.push({
      ruleId: 'SF-META-001',
      severity: 'notice',
      path: newObjects[0].filename,
      startLine: 1,
      endLine: 1,
      message: 'New custom object added without a corresponding Tab or Lightning Record Page.',
      suggestion: 'Create a tab and a Lightning record page so the object is accessible from the UI.',
    });
  }

  return findings;
}
