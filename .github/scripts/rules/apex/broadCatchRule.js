// SF-APEX-006 — Avoid catch(Exception e) with no meaningful handling
export default function broadCatchRule(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content || !file.filename.endsWith('.cls')) continue;

    const lines = file.content.split('\n');
    let inBroadCatch = false;
    let catchBraceDepth = 0;
    let catchBodyLines = [];
    let catchStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (/catch\s*\(\s*Exception\s+\w+\s*\)/.test(trimmed)) {
        inBroadCatch = true;
        catchBraceDepth = 0;
        catchBodyLines = [];
        catchStartLine = i + 1;
      }

      if (inBroadCatch) {
        catchBodyLines.push(trimmed);
        for (const ch of trimmed) {
          if (ch === '{') catchBraceDepth++;
          if (ch === '}') catchBraceDepth--;
        }

        // End of catch block
        if (catchBraceDepth === 0 && catchBodyLines.length > 1) {
          const body = catchBodyLines.join(' ');
          const hasOnlyLog = /\b(system\.debug|log|logger)\b/i.test(body) &&
            !/\b(throw|Database\.|insert|update|return\s+\w|rollback)\b/i.test(body);
          const isEmpty = /catch\s*\([^)]+\)\s*\{\s*\}/.test(body);

          if (hasOnlyLog || isEmpty) {
            findings.push({
              ruleId: 'SF-APEX-006',
              severity: 'warning',
              path: file.filename,
              startLine: catchStartLine,
              endLine: i + 1,
              message: 'Broad catch(Exception e) with no meaningful handling (only log or empty body).',
              suggestion: 'Re-throw as an ApplicationException, log with full context, or handle the specific exception type.',
            });
          }

          inBroadCatch = false;
          catchBodyLines = [];
        }
      }
    }
  }

  return findings;
}
