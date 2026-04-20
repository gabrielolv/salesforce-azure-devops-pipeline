// SF-APEX-007 — Non-selective or potentially expensive SOQL
const LARGE_OBJECTS = [
  'Lead', 'Case', 'Task', 'Event', 'EmailMessage', 'FeedItem',
  'ContentVersion', 'ContentDocument', 'Opportunity', 'Contact', 'Account',
];

const largeObjectPattern = new RegExp(
  `FROM\\s+(${LARGE_OBJECTS.join('|')})\\b`,
  'i'
);

export default function nonSelectiveQuery(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content || !file.filename.endsWith('.cls')) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // LIKE '%value%' — non-selective leading wildcard
      if (/LIKE\s+'%[^']+'/i.test(trimmed)) {
        findings.push({
          ruleId: 'SF-APEX-007',
          severity: 'warning',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: "SOQL with a leading wildcard (LIKE '%...') is non-selective and will trigger a full table scan.",
          suggestion: 'Use a trailing wildcard (LIKE \'value%\') or a more selective filter to keep queries within governor limits.',
        });
        continue;
      }

      // SELECT from large object without a WHERE clause
      if (/\[\s*SELECT\b/i.test(trimmed) && largeObjectPattern.test(trimmed) && !/\bWHERE\b/i.test(trimmed)) {
        findings.push({
          ruleId: 'SF-APEX-007',
          severity: 'warning',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: `SOQL on a typically large object (${trimmed.match(largeObjectPattern)?.[1]}) without a WHERE clause.`,
          suggestion: 'Add a selective WHERE clause. Consider querying only the fields and rows your code needs.',
        });
      }
    }
  }

  return findings;
}
