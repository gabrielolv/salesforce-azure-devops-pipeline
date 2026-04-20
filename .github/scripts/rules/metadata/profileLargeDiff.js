// SF-META-003 — Large profile diff is hard to review safely
const LARGE_DIFF_LINES = 100;

export default function profileLargeDiff(files) {
  const findings = [];

  for (const file of files) {
    if (!file.filename.endsWith('.profile-meta.xml')) continue;
    if (file.status === 'removed') continue;

    const changedLines = (file.additions ?? 0) + (file.deletions ?? 0);
    if (changedLines > LARGE_DIFF_LINES) {
      findings.push({
        ruleId: 'SF-META-003',
        severity: 'notice',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: `Profile has a large diff (${changedLines} changed lines). Large profile changes are risky and hard to peer-review.`,
        suggestion: 'Split profile changes across smaller PRs or migrate permissions to Permission Sets to reduce profile file size and merge conflicts.',
      });
    }
  }

  return findings;
}
