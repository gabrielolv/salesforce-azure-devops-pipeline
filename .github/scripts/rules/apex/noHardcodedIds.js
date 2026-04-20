// SF-APEX-005 — Hardcoded Salesforce IDs or org-specific URLs
const ID_15 = /\b[a-zA-Z0-9]{15}\b/;
const ID_18 = /\b[a-zA-Z0-9]{18}\b/;
const SF_URL = /https?:\/\/[a-zA-Z0-9\-]+\.(my\.salesforce\.com|lightning\.force\.com|salesforce\.com|force\.com)/i;
// Salesforce record ID prefixes suggest real IDs when they appear in string literals
const APEX_STRING_ID = /['"]([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})['"]/;

export default function noHardcodedIds(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;
    if (!file.filename.endsWith('.cls') && !file.filename.endsWith('.trigger')) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      if (SF_URL.test(trimmed)) {
        findings.push({
          ruleId: 'SF-APEX-005',
          severity: 'failure',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: 'Org-specific URL hardcoded in Apex. This will break across orgs and sandboxes.',
          suggestion: 'Use System.URL.getOrgDomainUrl() or a Custom Setting/Custom Metadata record for the endpoint.',
        });
        continue;
      }

      if (APEX_STRING_ID.test(trimmed)) {
        const match = trimmed.match(APEX_STRING_ID)[1];
        if (ID_15.test(match) || ID_18.test(match)) {
          findings.push({
            ruleId: 'SF-APEX-005',
            severity: 'failure',
            path: file.filename,
            startLine: i + 1,
            endLine: i + 1,
            message: `Possible hardcoded Salesforce record ID ("${match}") in Apex source.`,
            suggestion: 'Query for the record by a unique external ID or name rather than hardcoding the Salesforce ID.',
          });
        }
      }
    }
  }

  return findings;
}
