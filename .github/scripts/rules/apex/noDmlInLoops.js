// SF-APEX-002 — No DML inside loops
const DML_PATTERN = /^\s*(insert|update|delete|upsert|undelete|merge)\s+/i;

export default function noDmlInLoops(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content || !file.filename.endsWith('.cls')) continue;

    const lines = file.content.split('\n');
    let loopDepth = 0;
    let braceDepth = 0;
    let loopBraceStack = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].replace(/\/\/.*$/, '').trim();

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

      if (loopDepth > 0 && DML_PATTERN.test(trimmed)) {
        const keyword = trimmed.match(DML_PATTERN)[1].toLowerCase();
        findings.push({
          ruleId: 'SF-APEX-002',
          severity: 'failure',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: `DML statement (${keyword}) inside a loop. Each iteration consumes a DML governor limit.`,
          suggestion: 'Accumulate records in a List before the loop and perform a single bulk DML call after.',
        });
      }
    }
  }

  return findings;
}
