// SF-FLOW-001 — Any flow change requires a regression review notice
export default function flowReviewRequired(files) {
  const flowFiles = files.filter(
    f => f.filename.endsWith('.flow-meta.xml') && f.status !== 'removed'
  );

  return flowFiles.map(f => ({
    ruleId: 'SF-FLOW-001',
    severity: 'notice',
    path: f.filename,
    startLine: 1,
    endLine: 1,
    message: 'Flow metadata changed. Flows execute declaratively and require manual regression testing.',
    suggestion: 'Verify the flow in a sandbox against all relevant entry criteria. Check for interview limits and active record-triggered flow interactions.',
  }));
}
