// SF-TRIG-003 — Trigger may cascade without a recursion guard
export default function recursionGuard(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content || !file.filename.endsWith('.trigger')) continue;

    const content = file.content;

    // Check if the trigger updates the same object type it fires on
    const objectMatch = file.filename.match(/(\w+)\.trigger$/);
    if (!objectMatch) continue;
    const triggerObject = objectMatch[1].replace(/Trigger$/i, '');

    const hasSelfUpdate = new RegExp(`update\\s+\\w*${triggerObject}`, 'i').test(content);
    const hasGuard = /\bhasRun\b|\brecursion\b|\bTriggerContext\b|\bAlreadyRun\b/i.test(content);

    if (hasSelfUpdate && !hasGuard) {
      findings.push({
        ruleId: 'SF-TRIG-003',
        severity: 'notice',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: `Trigger on ${triggerObject} appears to update the same object without a visible recursion guard.`,
        suggestion: 'Add a static Boolean flag (e.g., TriggerContext.hasRun) to prevent infinite recursion when the trigger updates its own records.',
      });
    }
  }

  return findings;
}
