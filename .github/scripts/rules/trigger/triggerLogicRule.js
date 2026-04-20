// SF-TRIG-002 — Trigger contains business logic directly instead of delegating to a handler
const LOGIC_PATTERNS = [
  /\b(if|switch)\s*\(/,
  /\[\s*SELECT\b/i,
  /^\s*(insert|update|delete|upsert|undelete)\s+/i,
  /\.sendEmail\s*\(/i,
  /new\s+[A-Z]\w+\s*\(/,
];

export default function triggerLogicRule(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content || !file.filename.endsWith('.trigger')) continue;

    const lines = file.content.split('\n');
    let logicLineCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.length === 0) continue;
      if (LOGIC_PATTERNS.some(p => p.test(trimmed))) logicLineCount++;
    }

    // Delegate-only triggers usually call one handler method — very few logic lines
    if (logicLineCount > 5) {
      findings.push({
        ruleId: 'SF-TRIG-002',
        severity: 'warning',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: `Trigger file appears to contain business logic directly (${logicLineCount} logic lines detected).`,
        suggestion: 'Move all business logic to a dedicated handler/service class and keep the trigger body to a single dispatch call per context.',
      });
    }
  }

  return findings;
}
