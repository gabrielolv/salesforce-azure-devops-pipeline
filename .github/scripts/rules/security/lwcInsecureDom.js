// SF-SEC-004 — LWC insecure/global DOM patterns
const RISKY_PATTERNS = [
  { re: /\beval\s*\(/,                      msg: 'Use of eval() in LWC is forbidden under Lightning Web Security.' },
  { re: /innerHTML\s*=/,                    msg: 'Direct innerHTML assignment can introduce XSS. Use sanitized templates or lwc:html.' },
  { re: /document\.write\s*\(/,             msg: 'document.write() is blocked by Lightning Web Security.' },
  { re: /\bwindow\[/,                       msg: 'Dynamic window property access may be blocked under Lightning Web Security.' },
  { re: /\bnew\s+Function\s*\(/,            msg: 'new Function() is blocked by Lightning Web Security.' },
];

export default function lwcInsecureDom(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;
    const isLwcJs = file.filename.endsWith('.js') && file.filename.includes('/lwc/');
    if (!isLwcJs) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//')) continue;

      for (const { re, msg } of RISKY_PATTERNS) {
        if (re.test(trimmed)) {
          findings.push({
            ruleId: 'SF-SEC-004',
            severity: 'failure',
            path: file.filename,
            startLine: i + 1,
            endLine: i + 1,
            message: msg,
            suggestion: 'Use Lightning-safe equivalents. Refer to the LWC security guide and Lightning Web Security documentation.',
          });
          break;
        }
      }
    }
  }

  return findings;
}
