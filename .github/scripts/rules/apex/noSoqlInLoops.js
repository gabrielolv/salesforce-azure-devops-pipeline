// SF-APEX-001 — No SOQL inside loops
export default function noSoqlInLoops(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content || !file.filename.endsWith('.cls')) continue;

    const lines = file.content.split('\n');
    let loopDepth = 0;
    let braceDepth = 0;
    let loopBraceStack = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.replace(/\/\/.*$/, '').trim(); // strip inline comments

      if (/\b(for|while)\s*\(/.test(trimmed)) {
        loopDepth++;
        loopBraceStack.push(braceDepth);
      }

      for (const ch of trimmed) {
        if (ch === '{') {
          braceDepth++;
        } else if (ch === '}') {
          braceDepth--;
          if (loopBraceStack.length && braceDepth <= loopBraceStack[loopBraceStack.length - 1]) {
            loopBraceStack.pop();
            loopDepth = Math.max(0, loopDepth - 1);
          }
        }
      }

      if (loopDepth > 0 && /\[\s*SELECT\b/i.test(trimmed)) {
        findings.push({
          ruleId: 'SF-APEX-001',
          severity: 'failure',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: 'SOQL query inside a loop. This will consume one governor limit query per iteration.',
          suggestion: 'Collect IDs or criteria before the loop and execute a single SOQL query outside, then iterate over the result set.',
        });
      }
    }
  }

  return findings;
}
