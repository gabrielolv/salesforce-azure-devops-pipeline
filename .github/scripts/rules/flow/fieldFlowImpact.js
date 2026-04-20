// SF-FLOW-005 — New field added to an object that also has a flow change in this PR
function objectFromField(filename) {
  // path pattern: .../objects/ObjectName/fields/FieldName.field-meta.xml
  const parts = filename.split('/');
  const objIdx = parts.indexOf('objects');
  return objIdx !== -1 ? parts[objIdx + 1]?.toLowerCase() : null;
}

function objectFromFlow(content) {
  const m = content.match(/<object>(\w+)<\/object>/i);
  return m ? m[1].toLowerCase() : null;
}

export default function fieldFlowImpact(files) {
  const findings = [];

  const newFields = files.filter(
    f => f.status === 'added' && f.filename.includes('/fields/') && f.filename.endsWith('.field-meta.xml')
  );
  const flowChanges = files.filter(
    f => f.filename.endsWith('.flow-meta.xml') && f.status !== 'removed'
  );

  if (newFields.length === 0 || flowChanges.length === 0) return [];

  const flowObjects = new Set(
    flowChanges.map(f => f.content && objectFromFlow(f.content)).filter(Boolean)
  );

  for (const field of newFields) {
    const obj = objectFromField(field.filename);
    if (obj && flowObjects.has(obj)) {
      findings.push({
        ruleId: 'SF-FLOW-005',
        severity: 'notice',
        path: field.filename,
        startLine: 1,
        endLine: 1,
        message: `New field added to "${obj}" which also has a related flow change in this PR.`,
        suggestion: 'Verify that the existing flows referencing this object handle the new field correctly (assignment steps, conditions, screen fields).',
      });
    }
  }

  return findings;
}
