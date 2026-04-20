// SF-FLOW-002 — Flow missing a description or using a generic/unclear name
const VAGUE_NAME = /^(flow|new|test|copy|draft|temp|untitled|my_flow)/i;

export default function flowNamingRule(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content || !file.filename.endsWith('.flow-meta.xml')) continue;

    const hasDescription = /<description>\s*\S/.test(file.content);
    const flowFileName   = file.filename.split('/').pop().replace('.flow-meta.xml', '');

    if (!hasDescription) {
      findings.push({
        ruleId: 'SF-FLOW-002',
        severity: 'warning',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: 'Flow metadata has no <description>. Undocumented flows are difficult to maintain and audit.',
        suggestion: 'Add a <description> element explaining the flow purpose, trigger object, and intended business outcome.',
      });
    }

    if (VAGUE_NAME.test(flowFileName)) {
      findings.push({
        ruleId: 'SF-FLOW-002',
        severity: 'notice',
        path: file.filename,
        startLine: 1,
        endLine: 1,
        message: `Flow API name "${flowFileName}" appears generic or is a draft name.`,
        suggestion: 'Use a descriptive API name that conveys the object and purpose (e.g., Account_UpdateBillingOnClose).',
      });
    }
  }

  return findings;
}
