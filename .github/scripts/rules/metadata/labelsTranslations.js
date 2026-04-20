// SF-META-004 — User-facing metadata changed without label/translation review
const USER_FACING_PATTERNS = [
  /\.object-meta\.xml$/,
  /\/fields\/.*\.field-meta\.xml$/,
  /\.tab-meta\.xml$/,
  /\.app-meta\.xml$/,
  /\.layout-meta\.xml$/,
];

export default function labelsTranslations(files) {
  const findings = [];

  const userFacingChanged = files.filter(
    f => f.status !== 'removed' && USER_FACING_PATTERNS.some(p => p.test(f.filename))
  );

  if (userFacingChanged.length === 0) return [];

  const hasLabelOrTranslation = files.some(
    f => f.filename.endsWith('.labels-meta.xml') ||
         f.filename.endsWith('.translation-meta.xml') ||
         f.filename.includes('/translations/')
  );

  if (hasLabelOrTranslation) return [];

  findings.push({
    ruleId: 'SF-META-004',
    severity: 'notice',
    path: userFacingChanged[0].filename,
    startLine: 1,
    endLine: 1,
    message: `${userFacingChanged.length} user-facing metadata file(s) changed but no labels or translation files were updated.`,
    suggestion: 'If this org uses multiple languages or translations, verify that label and translation files are updated to match any renamed fields, objects, or tabs.',
  });

  return findings;
}
