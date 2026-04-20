// SF-LWC-002 — Prefer NavigationMixin over manual URL construction
const MANUAL_URL_PATTERNS = [
  /['"`]\/lightning\/r\//,
  /['"`]\/lightning\/n\//,
  /['"`]\/lightning\/o\//,
  /window\.location\s*=/,
  /window\.open\s*\(\s*['"`]\//,
];

export default function lwcNavigation(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;
    if (!file.filename.includes('/lwc/') || !file.filename.endsWith('.js')) continue;

    const usesNavigation = /NavigationMixin/.test(file.content);
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//')) continue;

      if (MANUAL_URL_PATTERNS.some(p => p.test(trimmed))) {
        findings.push({
          ruleId: 'SF-LWC-002',
          severity: 'warning',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: `Manual Salesforce URL construction detected${usesNavigation ? ' even though NavigationMixin is imported' : ''}.`,
          suggestion: "Use NavigationMixin.Navigate with a PageReference object (type: 'standard__recordPage', etc.) for portable, platform-managed navigation.",
        });
      }
    }
  }

  return findings;
}
