import { Octokit } from '@octokit/rest';
import { getDiffLines } from './utils/diffParser.js';
import { runAiReview } from './ai-review.js';

// ── Rule imports ──────────────────────────────────────────────────────────────
import noSoqlInLoops       from './rules/apex/noSoqlInLoops.js';
import noDmlInLoops        from './rules/apex/noDmlInLoops.js';
import bulkifiedLogic      from './rules/apex/bulkifiedLogic.js';
import apexTestChanged     from './rules/apex/apexTestChanged.js';
import noHardcodedIds      from './rules/apex/noHardcodedIds.js';
import broadCatchRule      from './rules/apex/broadCatchRule.js';
import nonSelectiveQuery   from './rules/apex/nonSelectiveQuery.js';

import oneTriggerPerObject from './rules/trigger/oneTriggerPerObject.js';
import triggerLogicRule    from './rules/trigger/triggerLogicRule.js';
import recursionGuard      from './rules/trigger/recursionGuard.js';

import preferPermissionSets  from './rules/security/preferPermissionSets.js';
import newFieldNeedsPermset  from './rules/security/newFieldNeedsPermset.js';
import sensitivePerms        from './rules/security/sensitivePerms.js';
import lwcInsecureDom        from './rules/security/lwcInsecureDom.js';

import lwcNoHardcodedUrls  from './rules/lwc/lwcNoHardcodedUrls.js';
import lwcNavigation       from './rules/lwc/lwcNavigation.js';
import lwcDomManipulation  from './rules/lwc/lwcDomManipulation.js';
import lwcHardcodedLabels  from './rules/lwc/lwcHardcodedLabels.js';
import lwcApexCallPattern  from './rules/lwc/lwcApexCallPattern.js';

import flowReviewRequired  from './rules/flow/flowReviewRequired.js';
import flowNamingRule      from './rules/flow/flowNamingRule.js';
import largeFlowRule       from './rules/flow/largeFlowRule.js';
import apexFlowSameObject  from './rules/flow/apexFlowSameObject.js';
import fieldFlowImpact     from './rules/flow/fieldFlowImpact.js';

import missingDependencies from './rules/metadata/missingDependencies.js';
import destructiveChanges  from './rules/metadata/destructiveChanges.js';
import profileLargeDiff    from './rules/metadata/profileLargeDiff.js';
import labelsTranslations  from './rules/metadata/labelsTranslations.js';
import mixedConcerns       from './rules/metadata/mixedConcerns.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const RULES = [
  noSoqlInLoops, noDmlInLoops, bulkifiedLogic, apexTestChanged,
  noHardcodedIds, broadCatchRule, nonSelectiveQuery,
  oneTriggerPerObject, triggerLogicRule, recursionGuard,
  preferPermissionSets, newFieldNeedsPermset, sensitivePerms, lwcInsecureDom,
  lwcNoHardcodedUrls, lwcNavigation, lwcDomManipulation, lwcHardcodedLabels, lwcApexCallPattern,
  flowReviewRequired, flowNamingRule, largeFlowRule, apexFlowSameObject, fieldFlowImpact,
  missingDependencies, destructiveChanges, profileLargeDiff, labelsTranslations, mixedConcerns,
];

const SEVERITY_ICON = { failure: '🔴', warning: '🟡', notice: '🔵' };
const SEVERITY_ORDER = { failure: 0, warning: 1, notice: 2 };

const { GITHUB_TOKEN, PR_NUMBER, REPO_OWNER, REPO_NAME, HEAD_SHA } = process.env;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// ── GitHub API helpers ────────────────────────────────────────────────────────
async function getChangedFiles() {
  const files = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.pulls.listFiles({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      pull_number: Number(PR_NUMBER),
      per_page: 100,
      page,
    });
    files.push(...data);
    if (data.length < 100) break;
    page++;
  }

  return files;
}

async function getFileContent(path) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      ref: HEAD_SHA,
    });
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

// ── Review posting ────────────────────────────────────────────────────────────
async function postReview(findings, enrichedFiles) {
  const hasFail = findings.some(f => f.severity === 'failure');

  // Build inline comments (only for lines present in the diff)
  const inlineComments = [];
  const bodyFindings = [];

  for (const finding of findings) {
    if (!finding.path || !finding.startLine) {
      bodyFindings.push(finding);
      continue;
    }

    const file = enrichedFiles.find(f => f.filename === finding.path);
    const diffLines = getDiffLines(file?.patch);

    if (diffLines.has(finding.startLine)) {
      inlineComments.push({
        path: finding.path,
        line: finding.startLine,
        side: 'RIGHT',
        body: formatInlineComment(finding),
      });
    } else {
      bodyFindings.push(finding);
    }
  }

  const reviewBody = buildReviewBody(findings, bodyFindings);

  await octokit.pulls.createReview({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    pull_number: Number(PR_NUMBER),
    commit_id: HEAD_SHA,
    event: hasFail ? 'REQUEST_CHANGES' : 'COMMENT',
    body: reviewBody,
    comments: inlineComments,
  });

  console.log(`Review posted — ${findings.length} finding(s), event: ${hasFail ? 'REQUEST_CHANGES' : 'COMMENT'}`);
}

function formatInlineComment(f) {
  const icon = SEVERITY_ICON[f.severity] ?? '⚪';
  let body = `${icon} **[${f.ruleId}]** ${f.message}`;
  if (f.suggestion) body += `\n\n> **Suggestion:** ${f.suggestion}`;
  return body;
}

function buildReviewBody(all, bodyOnly) {
  const failures = all.filter(f => f.severity === 'failure');
  const warnings = all.filter(f => f.severity === 'warning');
  const notices  = all.filter(f => f.severity === 'notice');

  if (all.length === 0) {
    return '## Salesforce PR Review ✅\n\nNo issues found. All best-practice checks passed.';
  }

  const lines = ['## Salesforce PR Review'];

  const summary = [];
  if (failures.length) summary.push(`${SEVERITY_ICON.failure} **${failures.length} failure(s)**`);
  if (warnings.length) summary.push(`${SEVERITY_ICON.warning} **${warnings.length} warning(s)**`);
  if (notices.length)  summary.push(`${SEVERITY_ICON.notice} **${notices.length} notice(s)**`);
  lines.push(summary.join('  ·  '));
  lines.push('');

  if (bodyOnly.length) {
    lines.push('### Findings');
    lines.push('');
    lines.push('| Severity | Rule | File | Line | Message |');
    lines.push('|----------|------|------|------|---------|');

    const sorted = [...bodyOnly].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );

    for (const f of sorted) {
      const icon     = SEVERITY_ICON[f.severity] ?? '⚪';
      const file     = f.path ? `\`${f.path}\`` : '—';
      const line     = f.startLine ? `L${f.startLine}` : '—';
      const msg      = f.message.replace(/\|/g, '\\|');
      lines.push(`| ${icon} ${f.severity} | ${f.ruleId} | ${file} | ${line} | ${msg} |`);
    }

    lines.push('');
    lines.push('> Inline comments above mark issues directly on changed lines.');
    lines.push('');

    // Suggestions block
    const withSuggestions = bodyOnly.filter(f => f.suggestion);
    if (withSuggestions.length) {
      lines.push('<details><summary>Suggestions</summary>');
      lines.push('');
      for (const f of withSuggestions) {
        lines.push(`**${f.ruleId}** — ${f.suggestion}`);
        lines.push('');
      }
      lines.push('</details>');
    }
  }

  const inlineCount = all.length - bodyOnly.length;
  if (inlineCount > 0) {
    lines.push(`\n> ${inlineCount} additional finding(s) posted as inline comments on the diff.`);
  }

  if (all.some(f => f.ruleId?.startsWith('SF-AI-'))) {
    lines.push('\n---');
    lines.push('> Findings prefixed `SF-AI-` are generated by Claude Sonnet (AI-powered cross-repo impact analysis).');
  }

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Reviewing PR #${PR_NUMBER} in ${REPO_OWNER}/${REPO_NAME}`);

  const rawFiles = await getChangedFiles();
  console.log(`Changed files: ${rawFiles.length}`);

  const enrichedFiles = await Promise.all(
    rawFiles.map(async f => ({
      ...f,
      content: f.status !== 'removed' ? await getFileContent(f.filename) : null,
    }))
  );

  const staticFindings = [];

  for (const rule of RULES) {
    try {
      const results = rule(enrichedFiles, enrichedFiles);
      if (Array.isArray(results)) staticFindings.push(...results);
    } catch (err) {
      console.error(`Rule error: ${err.message}`);
    }
  }

  const aiFindings = await runAiReview(enrichedFiles, staticFindings).catch(err => {
    console.error(`AI review error: ${err.message}`);
    return [];
  });

  const findings = [...staticFindings, ...aiFindings];

  console.log(`Total findings: ${findings.length} (static: ${staticFindings.length}, AI: ${aiFindings.length})`);
  findings.forEach(f => console.log(`  [${f.severity}] ${f.ruleId} — ${f.path ?? 'n/a'}`));

  await postReview(findings, enrichedFiles);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
