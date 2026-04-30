import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

// ── Token-budget constants ────────────────────────────────────────────────────
const REPO_ROOT = process.cwd();

// Lever 1 — Skip non-logic PRs entirely
// Only files with these extensions carry logic worth deep AI reasoning.
const LOGIC_EXTENSIONS = new Set(['.cls', '.trigger', '.js', '.html', '.flow-meta.xml']);

// Lever 2 — Diff-only for non-logic files
// These extensions get only their git diff, not their full content.
const DIFF_ONLY_EXTENSIONS = new Set([
  '.xml', '.profile-meta.xml', '.permissionset-meta.xml',
  '.object-meta.xml', '.field-meta.xml', '.layout-meta.xml',
  '.translation-meta.xml', '.labels-meta.xml', '.resource-meta.xml',
]);

// Lever 3 — Hard input cap (chars ≈ tokens × 4)
const MAX_INPUT_CHARS   = 50_000;  // ~12 500 input tokens ceiling
// Lever 4 — Lower output cap (15 JSON findings need < 1 500 tokens)
const MAX_OUTPUT_TOKENS = 2_048;
// Lever 5 — Fewer context files
const MAX_CONTEXT_FILES = 8;

const MAX_FILE_CHARS    = 5_000;  // per context file
const MAX_DIFF_CHARS    = 2_000;  // per diff block
const MAX_CONTENT_CHARS = 6_000;  // per logic file full content

// ── Helpers ───────────────────────────────────────────────────────────────────
function extOf(filename) {
  // Handle compound extensions like .flow-meta.xml → .flow-meta.xml
  const compoundMatch = filename.match(/(\.[a-z-]+\.xml)$/i);
  if (compoundMatch) return compoundMatch[1];
  return path.extname(filename).toLowerCase();
}

function isLogicFile(filename) {
  return LOGIC_EXTENSIONS.has(extOf(filename)) || LOGIC_EXTENSIONS.has(path.extname(filename));
}

function hasLogicFiles(changedFiles) {
  return changedFiles.some(f => isLogicFile(f.filename));
}

function estimateChars(str) { return str?.length ?? 0; }

function findFilesInDir(dir, predicate) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function walk(currentDir) {
    let entries;
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (predicate(entry.name, fullPath)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function toRelPath(absPath) {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function readFileSafe(absPath, maxChars = MAX_FILE_CHARS) {
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    return raw.length > maxChars ? raw.slice(0, maxChars) + '\n... [truncated]' : raw;
  } catch {
    return null;
  }
}

// ── Repo context builder ──────────────────────────────────────────────────────
function extractObjectNames(changedFiles) {
  const objects = new Set();
  for (const f of changedFiles) {
    const inObjects = f.filename.match(/\/objects\/([^/]+)\//);
    if (inObjects) objects.add(inObjects[1]);

    const triggerMatch = f.filename.match(/\/triggers\/([A-Za-z0-9]+?)_?[Tt]rigger\.cls$/);
    if (triggerMatch) objects.add(triggerMatch[1]);
  }
  return [...objects];
}

function buildRepoContext(changedFiles) {
  const changedPaths = new Set(changedFiles.map(f => f.filename));
  const contextMap   = new Map();

  const forceAppDir = path.join(REPO_ROOT, 'force-app');
  if (!fs.existsSync(forceAppDir)) return [];

  const objectNames = extractObjectNames(changedFiles);

  // Other triggers on the same object — execution-order conflicts
  for (const objName of objectNames) {
    const lower = objName.toLowerCase();
    findFilesInDir(forceAppDir, (name) => {
      const n = name.toLowerCase();
      return (n === `${lower}trigger.cls` || n === `${lower}_trigger.cls`) && !name.endsWith('-meta.xml');
    }).forEach(fp => {
      const rel = toRelPath(fp);
      if (!changedPaths.has(rel)) contextMap.set(rel, fp);
    });
  }

  // Flows on the same object — dual-automation detection
  for (const objName of objectNames) {
    const lower = objName.toLowerCase();
    findFilesInDir(forceAppDir, (name) =>
      name.toLowerCase().includes(lower) && name.endsWith('.flow-meta.xml')
    ).forEach(fp => {
      const rel = toRelPath(fp);
      if (!changedPaths.has(rel)) contextMap.set(rel, fp);
    });
  }

  // Apex classes imported by changed LWC files
  for (const f of changedFiles) {
    if (!f.filename.includes('/lwc/') || !f.filename.endsWith('.js') || !f.content) continue;
    const refs = [...f.content.matchAll(/from\s+'@salesforce\/apex\/([^'.]+)\./g)].map(m => m[1]);
    for (const className of refs) {
      findFilesInDir(forceAppDir, (name) => name === `${className}.cls`).forEach(fp => {
        const rel = toRelPath(fp);
        if (!changedPaths.has(rel)) contextMap.set(rel, fp);
      });
    }
  }

  // Object definitions for field/relationship context
  for (const objName of objectNames) {
    const objDef = path.join(forceAppDir, 'main', 'default', 'objects', objName, `${objName}.object-meta.xml`);
    if (fs.existsSync(objDef)) {
      const rel = toRelPath(objDef);
      if (!changedPaths.has(rel)) contextMap.set(rel, objDef);
    }
  }

  return [...contextMap.entries()]
    .slice(0, MAX_CONTEXT_FILES)
    .map(([relPath, absPath]) => ({ relPath, content: readFileSafe(absPath) }))
    .filter(f => f.content !== null);
}

// ── Prompt construction ───────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a Senior Salesforce Architect performing a strict READ-ONLY pull request review.

ROLE CONSTRAINTS — non-negotiable:
- You MUST NOT write, generate, or suggest replacement code or metadata.
- You MUST NOT produce code blocks intended to be copied into the repository.
- Your sole purpose is to IDENTIFY and DESCRIBE issues — not fix them.
- Suggestions must be brief descriptive guidance only, never actual code.

YOUR TWO OBJECTIVES:
1. Best Practice Enforcement — identify violations in the changed files that pattern-matching rules miss.
2. Cross-Repo Impact Analysis — using the "Related Repository Files" section, identify conflicts or breakage the PR may introduce to existing functionality.

SALESFORCE BEST PRACTICES TO CHECK:

Apex / Triggers
- CRUD/FLS: SOQL without WITH SECURITY_ENFORCED or Security.stripInaccessible; DML on records whose FLS was not verified.
- Sharing model: public/global methods in classes missing a sharing declaration, or "without sharing" where user context is expected.
- Mixed DML: setup objects (User, PermissionSet, PermissionSetAssignment) and non-setup objects in the same transaction outside an @future or Queueable.
- Async anti-patterns: @future calling @future, unbounded Queueable chains, callouts in synchronous triggers.
- Empty or log-only catch blocks that silently swallow exceptions.
- Test quality: missing System.assert* calls, SeeAllData=true, no test data isolation.

Triggers
- Business logic directly in the trigger body instead of a dedicated handler class.
- Trigger on an object that already has a record-triggered flow performing the same DML (dual-automation conflict).
- Multiple triggers on the same object — execution order is undefined.

Flows
- Record-triggered flow AND Apex trigger both writing the same fields on the same object.
- Screen flow elements with no fault connector.
- Hardcoded record type names, IDs, or queue names.
- Get Records element accessed without a null-safe check before downstream use.

LWC
- Imperative Apex calls without .catch() or try/catch error handling.
- Reactive state that is mutated without @track (API < 39) or property reassignment.

Security
- New custom fields without explicit FLS checks in related Apex.
- Permission set changes granting broad object CRUD or all-field access without field-level review.
- Fields matching sensitive patterns (password, ssn, creditcard, token, secret) not declared as EncryptedText.

Cross-Repo Impact
- Field rename or deletion that will break references visible in related files (flows, validation rules, Apex, LWC).
- Method signature change that breaks known callers in the related files.
- New validation rule logic that will fail existing test records.
- Two triggers on the same object creating an undefined execution order.

OUTPUT FORMAT — strict JSON only:
Return ONLY a valid JSON array. No markdown, no prose outside the JSON array.
Each element must match this schema exactly:
{
  "ruleId": "SF-AI-NNN",
  "severity": "failure" | "warning" | "notice",
  "path": "<relative file path, or null if repo-level>",
  "startLine": <integer or null>,
  "endLine": <integer or null>,
  "message": "<concise description of the issue>",
  "suggestion": "<one sentence of descriptive guidance — no code>"
}

Rule ID ranges:
- SF-AI-001 to SF-AI-099: best practice violations
- SF-AI-100 to SF-AI-199: cross-repo impact findings

Severity guide:
- failure  — governor limit error, security vulnerability, or definite runtime break
- warning  — likely bug, real best-practice violation, or probable cross-repo conflict
- notice   — code smell, missing defensive pattern, or low-probability impact worth flagging

Additional rules:
- Do NOT duplicate findings already listed in the Static Rule Findings input.
- Return [] if you find nothing new.
- Cap output at 15 findings. Prioritise by severity then potential impact.`;

// Lever 2 applied here: logic files get full content; metadata XML gets diff only.
function fileSection(f) {
  const lines = [`### ${f.filename} (status: ${f.status})`];

  if (isLogicFile(f.filename)) {
    if (f.content) {
      const src = f.content.length > MAX_CONTENT_CHARS
        ? f.content.slice(0, MAX_CONTENT_CHARS) + '\n... [truncated]'
        : f.content;
      lines.push('```', src, '```');
    } else if (f.patch) {
      lines.push('```diff', f.patch.slice(0, MAX_DIFF_CHARS), '```');
    }
  } else {
    // Non-logic file: diff is sufficient context
    if (f.patch) {
      lines.push('```diff', f.patch.slice(0, MAX_DIFF_CHARS), '```');
    }
  }

  return lines.join('\n');
}

function buildUserMessage(changedFiles, staticFindings, contextFiles) {
  const parts = [];

  parts.push('## PR Changed Files\n');
  for (const f of changedFiles) parts.push(fileSection(f) + '\n');

  parts.push('## Static Rule Findings (already detected — do not repeat)\n');
  if (staticFindings.length === 0) {
    parts.push('None.\n');
  } else {
    parts.push(
      staticFindings
        .map(f => `- [${f.severity}] ${f.ruleId}: ${f.message} (${f.path ?? 'repo'}:${f.startLine ?? '?'})`)
        .join('\n') + '\n'
    );
  }

  if (contextFiles.length > 0) {
    parts.push('## Related Repository Files (for cross-repo impact analysis)\n');
    for (const f of contextFiles) parts.push(`### ${f.relPath}\n\`\`\`\n${f.content}\n\`\`\`\n`);
  }

  return parts.join('\n');
}

// Lever 3: drop context files one-by-one until message fits under MAX_INPUT_CHARS.
function pruneToFit(changedFiles, staticFindings, contextFiles) {
  let files = [...contextFiles];
  let msg   = buildUserMessage(changedFiles, staticFindings, files);

  while (estimateChars(msg) > MAX_INPUT_CHARS && files.length > 0) {
    files.pop();
    msg = buildUserMessage(changedFiles, staticFindings, files);
  }

  return { message: msg, contextUsed: files.length, totalChars: estimateChars(msg) };
}

// ── Response parser ───────────────────────────────────────────────────────────
function parseAiFindings(text) {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { return []; }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(f =>
    typeof f.ruleId  === 'string' &&
    typeof f.message === 'string' &&
    ['failure', 'warning', 'notice'].includes(f.severity)
  );
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function runAiReview(changedFiles, staticFindings) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('AI review: ANTHROPIC_API_KEY not set — skipping');
    return [];
  }

  // Lever 1: bail out immediately if no logic files changed
  if (!hasLogicFiles(changedFiles)) {
    console.log('AI review: no logic files in PR (only metadata/XML) — skipping to save tokens');
    return [];
  }

  const client       = new Anthropic({ apiKey });
  const contextFiles = buildRepoContext(changedFiles);
  const objectNames  = extractObjectNames(changedFiles);

  // Lever 3: trim context until message fits the input budget
  const { message, contextUsed, totalChars } = pruneToFit(changedFiles, staticFindings, contextFiles);
  const estimatedInputTokens = Math.round(totalChars / 4);

  console.log(
    `AI review: ${changedFiles.filter(f => isLogicFile(f.filename)).length} logic file(s) ` +
    `(${changedFiles.length} total), ${contextUsed} context file(s), ` +
    `~${estimatedInputTokens.toLocaleString()} input tokens estimated, ` +
    `object(s): ${objectNames.join(', ') || 'none'}`
  );

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: MAX_OUTPUT_TOKENS,  // Lever 4
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },  // cache system prompt across calls
      },
    ],
    messages: [{ role: 'user', content: message }],
  });

  const usage = response.usage;
  console.log(
    `AI review: tokens used — input: ${usage.input_tokens}, ` +
    `output: ${usage.output_tokens}, ` +
    `cache_read: ${usage.cache_read_input_tokens ?? 0}, ` +
    `cache_write: ${usage.cache_creation_input_tokens ?? 0}`
  );

  const findings = parseAiFindings(response.content[0]?.text ?? '');
  console.log(`AI review: ${findings.length} finding(s) returned`);
  return findings;
}
