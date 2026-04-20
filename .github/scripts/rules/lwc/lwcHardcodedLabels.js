// SF-LWC-004 — Hardcoded user-facing text in LWC HTML templates
const VISIBLE_TEXT = /<(?:p|h\d|span|div|label|button|lightning-button|th|td)[^>]*>([^<]{20,})</i;

export default function lwcHardcodedLabels(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;
    if (!file.filename.includes('/lwc/') || !file.filename.endsWith('.html')) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('<!--')) continue;

      const match = trimmed.match(VISIBLE_TEXT);
      if (match) {
        const text = match[1].trim();
        // Skip template expressions like {label.Something}
        if (/^\{/.test(text)) continue;

        findings.push({
          ruleId: 'SF-LWC-004',
          severity: 'notice',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: `Hardcoded UI text detected: "${text.substring(0, 60)}${text.length > 60 ? '…' : ''}".`,
          suggestion: 'Consider using @salesforce/label custom labels for user-visible strings, especially in managed packages or multilingual deployments.',
        });
      }
    }
  }

  return findings;
}
