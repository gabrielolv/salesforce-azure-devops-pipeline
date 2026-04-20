// SF-LWC-005 — Review imperative Apex calls that may be replaceable with wire
export default function lwcApexCallPattern(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;
    if (!file.filename.includes('/lwc/') || !file.filename.endsWith('.js')) continue;

    const lines = file.content.split('\n');
    let imperativeCallCount = 0;
    const callLines = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Imperative Apex: imported method called with .then() or await
      if (/\bawait\s+\w+\(/.test(trimmed) || /\w+\(\s*\{/.test(trimmed)) {
        // Narrow: line also references an Apex import or has .then pattern
        if (/\.then\s*\(/.test(trimmed) || /\bawait\s+[A-Z]/.test(trimmed)) {
          imperativeCallCount++;
          callLines.push(i + 1);
        }
      }
    }

    const hasWire = /@wire\b/.test(file.content);

    if (imperativeCallCount >= 3 && !hasWire) {
      findings.push({
        ruleId: 'SF-LWC-005',
        severity: 'notice',
        path: file.filename,
        startLine: callLines[0] ?? 1,
        endLine: callLines[callLines.length - 1] ?? 1,
        message: `${imperativeCallCount} imperative Apex calls detected with no @wire adapter. Repeated calls on load may affect performance.`,
        suggestion: 'Evaluate whether @wire adapters can replace imperative calls for data that loads on component init, reducing redundant network requests.',
      });
    }
  }

  return findings;
}
