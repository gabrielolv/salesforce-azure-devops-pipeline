// SF-LWC-003 — Avoid unnecessary direct DOM manipulation in LWC
const DOM_PATTERNS = [
  { re: /document\.querySelector\b/,   label: 'document.querySelector' },
  { re: /document\.getElementById\b/,  label: 'document.getElementById' },
  { re: /document\.getElementsBy/,     label: 'document.getElementsBy*' },
  { re: /\.parentNode\b/,              label: '.parentNode traversal' },
  { re: /\.closest\s*\(\s*['"`][^'"`.]+['"`.]\s*\)/,  label: '.closest() DOM traversal' },
];

export default function lwcDomManipulation(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;
    if (!file.filename.includes('/lwc/') || !file.filename.endsWith('.js')) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//')) continue;

      for (const { re, label } of DOM_PATTERNS) {
        if (re.test(trimmed)) {
          findings.push({
            ruleId: 'SF-LWC-003',
            severity: 'warning',
            path: file.filename,
            startLine: i + 1,
            endLine: i + 1,
            message: `Direct DOM access via ${label} in LWC. Lightning Web Security may restrict cross-component DOM access.`,
            suggestion: 'Use this.template.querySelector() within the component scope. For inter-component communication use events or a pub/sub pattern.',
          });
          break;
        }
      }
    }
  }

  return findings;
}
