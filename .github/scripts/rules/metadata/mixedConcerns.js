// SF-META-005 — PR mixes too many unrelated metadata families
const FAMILIES = {
  apex:        f => f.endsWith('.cls') || f.endsWith('.trigger'),
  lwc:         f => f.includes('/lwc/'),
  aura:        f => f.includes('/aura/'),
  flows:       f => f.endsWith('.flow-meta.xml'),
  profiles:    f => f.endsWith('.profile-meta.xml'),
  permsets:    f => f.endsWith('.permissionset-meta.xml'),
  objects:     f => f.includes('/objects/') && !f.includes('/fields/'),
  fields:      f => f.includes('/fields/'),
  layouts:     f => f.includes('/layouts/'),
  reports:     f => f.includes('/reports/'),
  dashboards:  f => f.includes('/dashboards/'),
  staticRes:   f => f.includes('/staticresources/'),
};

const THRESHOLD = 5; // more than 5 distinct families = mixed concern

export default function mixedConcerns(files) {
  const activeFiles = files.filter(f => f.status !== 'removed');
  const touched = new Set();

  for (const file of activeFiles) {
    for (const [family, test] of Object.entries(FAMILIES)) {
      if (test(file.filename)) touched.add(family);
    }
  }

  if (touched.size <= THRESHOLD) return [];

  return [{
    ruleId: 'SF-META-005',
    severity: 'notice',
    path: null,
    startLine: null,
    endLine: null,
    message: `PR touches ${touched.size} distinct metadata families: ${[...touched].join(', ')}. Mixed-concern PRs increase deployment risk and are harder to roll back.`,
    suggestion: 'Consider splitting this PR by concern (e.g., a data model PR, a UI PR, and a security PR) to reduce blast radius and simplify review.',
  }];
}
