// SF-LWC-001 — Hardcoded Salesforce URLs or IDs in LWC JS/HTML
const SF_URL     = /https?:\/\/[a-zA-Z0-9\-]+\.(my\.salesforce\.com|lightning\.force\.com|salesforce\.com|force\.com)/i;
const RECORD_ID  = /['"`]([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})['"`]/;

export default function lwcNoHardcodedUrls(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;
    const isLwc = file.filename.includes('/lwc/') &&
      (file.filename.endsWith('.js') || file.filename.endsWith('.html'));
    if (!isLwc) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('<!--')) continue;

      if (SF_URL.test(trimmed)) {
        findings.push({
          ruleId: 'SF-LWC-001',
          severity: 'failure',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: 'Hardcoded Salesforce domain URL found in LWC. This breaks across orgs and sandboxes.',
          suggestion: 'Use NavigationMixin or @salesforce/baseUrl imports to build URLs dynamically.',
        });
        continue;
      }

      if (RECORD_ID.test(trimmed)) {
        findings.push({
          ruleId: 'SF-LWC-001',
          severity: 'failure',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: 'Possible hardcoded Salesforce record ID in LWC source.',
          suggestion: 'Pass record IDs via component properties or wire adapters, never as literals.',
        });
      }
    }
  }

  return findings;
}
