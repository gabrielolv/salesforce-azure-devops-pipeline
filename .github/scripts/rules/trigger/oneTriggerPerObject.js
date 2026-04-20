// SF-TRIG-001 — Only one trigger per SObject
export default function oneTriggerPerObject(files, allFiles) {
  const findings = [];
  const triggerFiles = allFiles.filter(f => f.filename.endsWith('.trigger'));

  // Group by object name (filename pattern: ObjectName.trigger)
  const byObject = new Map();

  for (const f of triggerFiles) {
    const base = f.filename.split('/').pop().replace('.trigger', '');
    // Strip common trigger suffix conventions like AccountTrigger → Account
    const object = base.replace(/Trigger$/i, '');
    if (!byObject.has(object)) byObject.set(object, []);
    byObject.get(object).push(f.filename);
  }

  for (const [object, paths] of byObject) {
    if (paths.length > 1) {
      findings.push({
        ruleId: 'SF-TRIG-001',
        severity: 'warning',
        path: paths[0],
        startLine: 1,
        endLine: 1,
        message: `Multiple triggers detected for object "${object}": ${paths.map(p => p.split('/').pop()).join(', ')}.`,
        suggestion: 'Consolidate to a single trigger per object and delegate logic to a handler class to avoid ordering issues.',
      });
    }
  }

  return findings;
}
