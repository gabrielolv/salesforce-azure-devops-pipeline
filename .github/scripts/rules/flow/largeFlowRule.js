// SF-FLOW-003 — Large or complex record-triggered flow
const LINE_THRESHOLD  = 400;
const LOOP_THRESHOLD  = 3;

export default function largeFlowRule(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content || !file.filename.endsWith('.flow-meta.xml')) continue;

    const lineCount = file.content.split('\n').length;
    const loopCount = (file.content.match(/<loops>/gi) || []).length;

    const isRecordTriggered = /<triggerType>RecordBeforeSave|RecordAfterSave<\/triggerType>/.test(file.content);

    if (isRecordTriggered && lineCount > LINE_THRESHOLD) {
      findings.push({
        ruleId: 'SF-FLOW-003',
        severity: 'notice',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: `Record-triggered flow is large (${lineCount} lines). Complex flows raise governor-limit and maintenance risk.`,
        suggestion: 'Break large flows into sub-flows with targeted entry criteria. Consider moving complex logic to Apex for testability.',
      });
    }

    if (loopCount > LOOP_THRESHOLD) {
      findings.push({
        ruleId: 'SF-FLOW-003',
        severity: 'notice',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: `Flow contains ${loopCount} loop elements. Excessive looping in flows can exhaust DML and query limits.`,
        suggestion: 'Minimise loop usage in flows. Bulk-safe collection operations and Apex integrations are more governor-friendly.',
      });
    }
  }

  return findings;
}
