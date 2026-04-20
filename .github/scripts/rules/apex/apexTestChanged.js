// SF-APEX-004 — Apex change without a related test class change
export default function apexTestChanged(files) {
  const apexChanged = files.filter(
    f => f.filename.endsWith('.cls') && f.status !== 'removed' &&
         !/(Test|_test)\.cls$/i.test(f.filename)
  );

  if (apexChanged.length === 0) return [];

  const testChanged = files.some(
    f => f.status !== 'removed' &&
         (/(Test|_test)\.cls$/i.test(f.filename) ||
          (f.content && /@isTest/i.test(f.content)))
  );

  if (testChanged) return [];

  return apexChanged.map(f => ({
    ruleId: 'SF-APEX-004',
    severity: 'warning',
    path: f.filename,
    startLine: 1,
    endLine: 1,
    message: 'Apex class changed but no test class (*Test.cls / @isTest) was updated in this PR.',
    suggestion: 'Add or update test coverage that exercises the changed logic.',
  }));
}
