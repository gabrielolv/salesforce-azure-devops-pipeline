// SF-FLOW-004 — Apex trigger AND flow changed on the same object
function extractObjectFromTrigger(filename) {
  const base = filename.split('/').pop().replace('.trigger', '');
  return base.replace(/Trigger$/i, '').toLowerCase();
}

function extractObjectFromFlow(content) {
  const m = content.match(/<object>(\w+)<\/object>/i);
  return m ? m[1].toLowerCase() : null;
}

export default function apexFlowSameObject(files) {
  const findings = [];

  const triggerFiles = files.filter(f => f.filename.endsWith('.trigger') && f.status !== 'removed');
  const flowFiles    = files.filter(f => f.filename.endsWith('.flow-meta.xml') && f.status !== 'removed');

  if (triggerFiles.length === 0 || flowFiles.length === 0) return [];

  const triggerObjects = new Set(triggerFiles.map(f => extractObjectFromTrigger(f.filename)));

  for (const flowFile of flowFiles) {
    if (!flowFile.content) continue;
    const flowObject = extractObjectFromFlow(flowFile.content);
    if (!flowObject) continue;

    if (triggerObjects.has(flowObject)) {
      findings.push({
        ruleId: 'SF-FLOW-004',
        severity: 'warning',
        path: flowFile.filename,
        startLine: 1,
        endLine: 1,
        message: `Both an Apex trigger and a Flow target "${flowObject}". Verify execution order and potential logic duplication.`,
        suggestion: 'Confirm which runs first (Apex before-triggers → flows → after-triggers). Check for duplicate field assignments or cascading DML.',
      });
    }
  }

  return findings;
}
