// SF-SEC-003 — High-risk permissions added to profiles or permission sets
const HIGH_RISK = [
  'ModifyAllData',
  'ViewAllData',
  'AuthorApex',
  'CustomizeApplication',
  'ManageUsers',
  'ResetPasswords',
  'InstallPackaging',
  'PublishPackaging',
  'ManageEncryptionKeys',
];

const permPattern = new RegExp(
  `<(${HIGH_RISK.join('|')})>\\s*true\\s*</(${HIGH_RISK.join('|')})>`,
  'i'
);

export default function sensitivePerms(files) {
  const findings = [];

  for (const file of files) {
    if (!file.content) continue;
    if (
      !file.filename.endsWith('.profile-meta.xml') &&
      !file.filename.endsWith('.permissionset-meta.xml')
    ) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(permPattern);
      if (match) {
        const perm = match[1];
        findings.push({
          ruleId: 'SF-SEC-003',
          severity: 'failure',
          path: file.filename,
          startLine: i + 1,
          endLine: i + 1,
          message: `High-risk permission "${perm}" is set to true. This grants broad org-level access.`,
          suggestion: `Confirm with a security/architecture review that ${perm} is intentionally granted. Prefer narrow permission assignments.`,
        });
      }
    }
  }

  return findings;
}
