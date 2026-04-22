# Salesforce PR Review Bot

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [How It Works](#how-it-works)
4. [GitHub App Setup](#github-app-setup)
5. [Rule Reference](#rule-reference)
   - [Apex Rules](#apex-rules)
   - [Trigger Architecture Rules](#trigger-architecture-rules)
   - [Security Rules](#security-rules)
   - [LWC Rules](#lwc-rules)
   - [Flow & Automation Rules](#flow--automation-rules)
   - [Metadata & Deployment Rules](#metadata--deployment-rules)
6. [Severity Model](#severity-model)
7. [File Structure](#file-structure)
8. [Adding a New Rule](#adding-a-new-rule)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The **Salesforce PR Review Bot** is an automated code review tool built on a GitHub App. Every Pull Request opened against the `develop` branch is automatically inspected for Salesforce best-practice violations before a human reviewer sees it.

The bot covers six domains: Apex code quality, trigger architecture, security, Lightning Web Components, Flow automation, and metadata deployment safety. Each check produces a finding with a severity level, an explanation of why the rule matters, and a concrete suggestion for how to fix it.

```
Developer opens PR → GitHub App generates token → review.js fetches changed files
→ 29 rules run in parallel → findings posted as inline diff comments + summary table
```

The goal is to catch governor-limit risks, security misconfigurations, and deployment hazards at the **lowest possible cost** — before the code reaches a Salesforce org.

---

## Architecture

```
.github/
├── workflows/
│   └── salesforce-pr-review.yml     ← workflow trigger (PR → develop)
└── scripts/
    ├── package.json                  ← @octokit/rest dependency
    ├── review.js                     ← orchestrator: fetches files, runs rules, posts review
    ├── utils/
    │   └── diffParser.js             ← maps file line numbers to diff positions
    └── rules/
        ├── apex/          (7 rules)
        ├── trigger/       (3 rules)
        ├── security/      (4 rules)
        ├── lwc/           (5 rules)
        ├── flow/          (5 rules)
        └── metadata/      (5 rules)
```

### Components

| Component | Purpose |
|---|---|
| `salesforce-pr-review.yml` | Triggers on PR events, generates the GitHub App token, and runs the review script |
| `review.js` | Fetches all changed files from the PR, passes them through every rule, and posts the review via the GitHub API |
| `diffParser.js` | Parses unified diff format to determine which file line numbers appear in the PR diff, enabling precise inline comments |
| Rule files | Each file exports a single function that receives the changed file list and returns an array of findings |

### GitHub App

The bot authenticates as a **GitHub App** rather than a personal access token. This provides:

- A dedicated identity (appears as `salesforce-pr-review-bot` in the PR, not as a user account)
- Fine-grained permissions scoped to only what is needed
- No dependency on any individual team member's GitHub account

---

## How It Works

### Step 1 — PR Opened

When a developer opens a Pull Request against `develop`, the `salesforce-pr-review.yml` workflow triggers with the `pull_request` event.

### Step 2 — Token Generation

The workflow uses `actions/create-github-app-token@v1` with the App's ID and private key (stored as GitHub Environment secrets in `salesforce-pr-review-bot`) to generate a short-lived installation access token scoped to the repository.

### Step 3 — File Fetching

`review.js` calls the GitHub REST API to retrieve the full list of files changed in the PR, including:
- File path and change status (`added`, `modified`, `removed`, `renamed`)
- The unified diff (patch) for each changed file
- Addition and deletion line counts

For every non-deleted file, the script fetches the current file content from the HEAD commit so rules can inspect the full source, not just the diff.

### Step 4 — Rules Engine

All 29 rule functions are called in sequence. Each rule receives:

```javascript
rule(enrichedFiles, enrichedFiles)
//    ↑ changed files with content and patch data
```

Rules are pure functions — they do not call any external APIs. They scan file content using regular expressions and structural analysis, then return an array of zero or more findings.

### Step 5 — Review Posting

Findings are split into two groups:

- **Inline comments** — findings whose line number falls within the PR diff. Posted directly on the relevant diff line.
- **Summary table** — findings on lines not in the diff (e.g., a file-level rule that flags line 1). Included in the review body as a formatted table.

The review is posted via `octokit.pulls.createReview()` as a `COMMENT` event (the App uses `COMMENT` rather than `REQUEST_CHANGES` to remain compatible with all repository configurations). Failures are communicated through the review body heading: **❌ Action Required** when failures exist, **⚠️ Warnings** for warnings and notices only.

### Inline Comment Example

```
🔴 [SF-APEX-001] SOQL query inside a loop. This will consume one governor
limit query per iteration.

> Suggestion: Collect IDs or criteria before the loop and execute a single
  SOQL query outside, then iterate over the result set.
```

### Summary Table Example

| Severity | Rule | File | Line | Message |
|---|---|---|---|---|
| 🟡 warning | SF-APEX-004 | `classes/MyClass.cls` | L1 | Apex class changed but no test class updated in this PR. |
| 🔵 notice | SF-FLOW-001 | `flows/My_Flow.flow-meta.xml` | L1 | Flow metadata changed. Flows require manual regression testing. |

---

## GitHub App Setup

### Required App Permissions

| Permission | Level | Reason |
|---|---|---|
| Contents | Read | Fetch file contents at HEAD commit |
| Pull requests | Read & write | Read PR file list, post review comments |
| Metadata | Read | Required for GitHub Apps on Salesforce repositories |

### Secrets Configuration

The workflow reads from the `salesforce-pr-review-bot` GitHub Environment:

| Secret | Value |
|---|---|
| `GH_APP_ID` | The App's numeric ID (e.g., `3443940`) — numbers only, no quotes |
| `GH_APP_PRIVATE_KEY` | The full contents of the `.pem` file downloaded from App settings |

#### Private Key Format

The private key must be stored exactly as downloaded — including header, footer, and all line breaks:

```
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
...multiple lines...
-----END RSA PRIVATE KEY-----
```

**Do not** paste it as a single line. GitHub Secrets supports multiline values — paste the file content directly.

If the key file begins with `-----BEGIN PRIVATE KEY-----` (PKCS#8 format), convert it first:

```bash
openssl rsa -in your-app.private-key.pem -out converted-key.pem
```

### Approving Permission Updates

When App permissions are changed in GitHub App settings, the installation owner must approve the updated permissions. Go to **github.com/settings/installations**, find the bot, and click **Review request**. Until approved, tokens generated by the App will still carry the old, more restricted permissions.

---

## Rule Reference

### Apex Rules

---

#### SF-APEX-001 — No SOQL in Loops
**Severity:** 🔴 Failure

**What it checks:** Apex `.cls` files for `[SELECT ...]` queries that appear inside `for` or `while` loop bodies.

**Why it matters:** Salesforce enforces a hard governor limit of 100 SOQL queries per transaction. Each loop iteration that contains a SOQL query consumes one query against this limit. A loop that processes 101 records will throw a `LimitException` at runtime.

**Correct pattern:**
```apex
// Collect IDs first, then query once
Set<Id> accountIds = new Set<Id>();
for (Contact c : contacts) {
    accountIds.add(c.AccountId);
}
Map<Id, Account> accounts = new Map<Id, Account>(
    [SELECT Id, Name FROM Account WHERE Id IN :accountIds]
);
```

---

#### SF-APEX-002 — No DML in Loops
**Severity:** 🔴 Failure

**What it checks:** Apex `.cls` files for `insert`, `update`, `delete`, `upsert`, `undelete`, or `merge` statements inside loops.

**Why it matters:** Salesforce limits DML operations to 150 per transaction. Each DML call inside a loop consumes one operation per iteration.

**Correct pattern:**
```apex
List<Contact> toUpdate = new List<Contact>();
for (Contact c : contacts) {
    c.Title = 'Reviewed';
    toUpdate.add(c);
}
update toUpdate; // single DML call
```

---

#### SF-APEX-003 — Bulkified Trigger and Helper Logic
**Severity:** 🟡 Warning

**What it checks:** Trigger files and handler/helper/service classes for `Trigger.new[0]` or `Trigger.old[0]` index-zero access patterns.

**Why it matters:** Salesforce can deliver up to 200 records in a single trigger execution (e.g., a data load). A trigger that only processes the first record silently ignores the rest.

**Correct pattern:**
```apex
for (Account acc : Trigger.new) {
    // process each record
}
```

---

#### SF-APEX-004 — Apex Change Without Test Change
**Severity:** 🟡 Warning

**What it checks:** Whether any non-test Apex class was modified without a corresponding `*Test.cls` or `@isTest` class being updated or added in the same PR.

**Why it matters:** Untested Apex changes are invisible to the coverage enforcement that protects production. This rule is a review signal, not a hard block — there are valid reasons to update logic without changing tests, but it should be a conscious decision that a reviewer explicitly approves.

---

#### SF-APEX-005 — Hardcoded IDs and Org-Specific URLs
**Severity:** 🔴 Failure

**What it checks:** Apex source for string literals containing 15- or 18-character Salesforce record IDs, or URLs containing `.my.salesforce.com`, `.lightning.force.com`, or similar org-specific domains.

**Why it matters:** Hardcoded record IDs refer to specific records in one org. The same ID will not exist in a sandbox or a different production org, causing runtime failures. Hardcoded URLs break cross-org portability and expose internal org domain structure.

**Correct pattern:**
```apex
// Query by external ID or name instead of hardcoded ID
Account acc = [SELECT Id FROM Account WHERE External_ID__c = 'ACME-001' LIMIT 1];

// Use platform methods for URLs
String orgUrl = System.URL.getOrgDomainUrl().toExternalForm();
```

---

#### SF-APEX-006 — Broad catch(Exception e) With No Meaningful Handling
**Severity:** 🟡 Warning

**What it checks:** Apex `.cls` files for `catch (Exception e)` blocks whose body only contains a `System.debug` call or is entirely empty.

**Why it matters:** Swallowing exceptions silently hides failures. A transaction that should have failed will appear to succeed, leaving data in an inconsistent state. Even a log-only catch block provides no actionable alert to the operations team.

**Correct pattern:**
```apex
try {
    // operation
} catch (DmlException e) {
    // handle the specific exception type
    throw new ApplicationException('Failed to save record: ' + e.getMessage(), e);
}
```

---

#### SF-APEX-007 — Non-Selective SOQL Query
**Severity:** 🟡 Warning

**What it checks:** Two patterns:
1. `LIKE '%value%'` — a leading wildcard, which forces a full table scan because the index cannot be used.
2. `SELECT ... FROM <large object>` without a `WHERE` clause on commonly large standard objects (Lead, Case, Contact, Account, Opportunity, etc.).

**Why it matters:** Non-selective queries on large objects can time out or consume disproportionate query time, especially as data volumes grow. Salesforce may return a `QUERY_TIMEOUT` or `UNABLE_TO_LOCK_ROW` error under load.

---

### Trigger Architecture Rules

---

#### SF-TRIG-001 — One Trigger Per Object
**Severity:** 🟡 Warning

**What it checks:** Whether more than one `.trigger` file exists for the same SObject in the PR or repository.

**Why it matters:** Multiple triggers on the same object execute in an undefined order. There is no guaranteed sequence between `AccountTrigger.trigger` and `AccountValidationTrigger.trigger`. This makes it impossible to reason about execution order, creates recursion risks, and makes the codebase harder to maintain.

**Correct pattern:** One trigger per object that delegates to a handler class:
```apex
trigger AccountTrigger on Account (before insert, before update, after insert, after update) {
    AccountTriggerHandler.dispatch(Trigger.operationType);
}
```

---

#### SF-TRIG-002 — Business Logic Directly in Trigger
**Severity:** 🟡 Warning

**What it checks:** Trigger files for a high density of logic-bearing lines — conditional statements, SOQL queries, DML, object instantiations, and method calls — indicating that business logic was written directly in the trigger body rather than delegated to a handler class.

**Why it matters:** Logic in the trigger body is difficult to unit test in isolation, cannot be reused from other contexts (e.g., batch jobs or REST APIs), and makes the trigger file grow into an unmanageable blob over time. The handler pattern separates concerns and enables targeted testing.

**Correct pattern:**
```apex
trigger ContactTrigger on Contact (before insert, after update) {
    new ContactTriggerHandler().run();
}
```

---

#### SF-TRIG-003 — Missing Recursion Guard
**Severity:** 🔵 Notice

**What it checks:** Trigger files that appear to update the same object they fire on, without a visible static Boolean guard to prevent re-entry.

**Why it matters:** A trigger that updates Account records will re-fire the Account trigger. Without a guard, this creates an infinite recursion loop that terminates with a `System.LimitException: Maximum trigger depth exceeded` error.

**Correct pattern:**
```apex
public class TriggerContext {
    public static Boolean hasRun = false;
}

trigger AccountTrigger on Account (after update) {
    if (TriggerContext.hasRun) return;
    TriggerContext.hasRun = true;
    AccountTriggerHandler.handleAfterUpdate(Trigger.new, Trigger.oldMap);
}
```

---

### Security Rules

---

#### SF-SEC-001 — Prefer Permission Sets Over Profiles
**Severity:** 🟡 Warning

**What it checks:** Whether any `.profile-meta.xml` file was modified in the PR.

**Why it matters:** Salesforce security guidance recommends managing access through Permission Sets rather than Profiles. Profiles define the baseline minimum access; Permission Sets layer additional access on top. Assigning access by task through Permission Sets makes it easier to audit what access a user has, reduces profile bloat, and aligns with Salesforce's long-term platform direction.

---

#### SF-SEC-002 — New Field Without Permission Set Update
**Severity:** 🟡 Warning

**What it checks:** Whether a new `.field-meta.xml` file was added without any `.permissionset-meta.xml` file being updated in the same PR.

**Why it matters:** New custom fields default to hidden for all users except System Administrators. If the Permission Set that grants access to the related object is not updated to include the new field, users will not be able to see or edit it even after deployment. This is a silent accessibility failure that requires a follow-up deployment to fix.

---

#### SF-SEC-003 — High-Risk Permissions Added
**Severity:** 🔴 Failure

**What it checks:** Profile and Permission Set metadata for the following permissions being set to `true`:

| Permission | What It Grants |
|---|---|
| `ModifyAllData` | Read, create, edit, and delete all records in the org |
| `ViewAllData` | Read all records in the org, ignoring sharing rules |
| `AuthorApex` | Create and execute Apex code in production |
| `CustomizeApplication` | Modify most application settings |
| `ManageUsers` | Create, edit, and deactivate users; assign permission sets |
| `ResetPasswords` | Reset any user's password |
| `ManageEncryptionKeys` | Manage Platform Encryption keys |

**Why it matters:** These permissions grant broad, org-wide access that bypasses record sharing and standard security boundaries. Their addition to a profile or permission set should always require explicit security review and sign-off.

---

#### SF-SEC-004 — LWC Insecure DOM Patterns
**Severity:** 🔴 Failure

**What it checks:** LWC JavaScript files for patterns that are blocked or restricted under **Lightning Web Security (LWS)**:

| Pattern | Reason |
|---|---|
| `eval()` | Blocked entirely under LWS |
| `innerHTML =` | XSS risk; use template binding instead |
| `document.write()` | Blocked under LWS |
| `window[...]` | Dynamic global access may be blocked |
| `new Function()` | Blocked under LWS |

**Why it matters:** Lightning Web Security is Salesforce's security model for LWC components. Code that bypasses the component model's rendering pipeline can introduce XSS vulnerabilities and will behave differently — or fail entirely — in the LWS execution environment.

---

### LWC Rules

---

#### SF-LWC-001 — Hardcoded URLs or IDs in LWC
**Severity:** 🔴 Failure

**What it checks:** LWC `.js` and `.html` files for hardcoded Salesforce domain URLs or record ID literals.

**Why it matters:** Same as SF-APEX-005, but in the LWC context. A component that constructs `/lightning/r/Account/<hardcodedId>/view` will fail in any org other than where the ID was copied from. Hardcoded Salesforce domains break sandbox-to-production portability.

---

#### SF-LWC-002 — Manual URL Construction Instead of NavigationMixin
**Severity:** 🟡 Warning

**What it checks:** LWC JavaScript files for string literals containing `/lightning/r/`, `/lightning/n/`, `/lightning/o/`, `window.location =`, or `window.open('/')` patterns.

**Why it matters:** Manually constructed Salesforce navigation URLs are fragile — they break if the record type, page layout, or app changes. `NavigationMixin` with `PageReference` objects is the platform-managed alternative that remains correct across org configurations.

**Correct pattern:**
```javascript
import { NavigationMixin } from 'lightning/navigation';

this[NavigationMixin.Navigate]({
    type: 'standard__recordPage',
    attributes: {
        recordId: this.recordId,
        actionName: 'view'
    }
});
```

---

#### SF-LWC-003 — Direct DOM Manipulation
**Severity:** 🟡 Warning

**What it checks:** LWC JavaScript files for `document.querySelector`, `document.getElementById`, `document.getElementsBy*`, `.parentNode`, and broad `.closest()` calls.

**Why it matters:** LWC components render inside a shadow DOM boundary. Using `document.querySelector` from inside a component cannot reliably reach elements inside other components' shadow roots. Lightning Web Security also restricts cross-component DOM access. The platform-safe equivalent is `this.template.querySelector()`, which is scoped to the current component's DOM.

---

#### SF-LWC-004 — Hardcoded User-Facing Text
**Severity:** 🔵 Notice

**What it checks:** LWC `.html` template files for visible text content longer than 20 characters inside common UI tags (`<p>`, `<h1>-<h6>`, `<span>`, `<div>`, `<label>`, `<button>`, `<td>`, `<th>`).

**Why it matters:** Hardcoded strings in templates cannot be translated, cannot be changed without a metadata deployment, and are inconsistent with Salesforce's Custom Labels system. In managed packages or multilingual orgs, all user-visible strings should reference a Custom Label.

**Correct pattern:**
```html
<!-- Instead of hardcoded text -->
<p>No records found.</p>

<!-- Use a custom label -->
<p>{label.No_Records_Found}</p>
```

---

#### SF-LWC-005 — Repetitive Imperative Apex Calls
**Severity:** 🔵 Notice

**What it checks:** LWC JavaScript files that contain three or more imperative Apex calls (detected as `await UpperCaseMethod(` or `.then(` chains) with no `@wire` adapters present.

**Why it matters:** Apex methods called imperatively on component load are not cached by the Lightning Data Service. Multiple imperative calls on the same data refresh path can generate redundant server round-trips and increase component load time. Where the data source is stable, `@wire` adapters benefit from platform-level caching and reactivity.

---

### Flow & Automation Rules

---

#### SF-FLOW-001 — Flow Changed: Regression Review Required
**Severity:** 🔵 Notice

**What it checks:** Whether any `.flow-meta.xml` file was modified or added in the PR.

**Why it matters:** Flows execute declaratively and are not covered by Apex test classes. There is no automated test runner for flow logic — correctness must be verified through manual end-to-end testing in a sandbox. Any flow change is flagged to remind reviewers that the flow must be re-tested before the PR is merged.

---

#### SF-FLOW-002 — Flow Missing Description or Using a Vague Name
**Severity:** 🟡 Warning

**What it checks:**
1. Whether the flow metadata contains a `<description>` element with content.
2. Whether the flow's API name matches a list of generic names (`flow`, `new`, `test`, `copy`, `draft`, `temp`, `untitled`, `my_flow`).

**Why it matters:** Undocumented flows become maintenance liabilities. When a flow causes an unexpected error months after deployment, the only way to understand its intent is through its label, description, and API name. Salesforce's own flow documentation guidelines explicitly call for descriptive labels, API names, and descriptions.

---

#### SF-FLOW-003 — Large or Complex Record-Triggered Flow
**Severity:** 🔵 Notice

**What it checks:** Record-triggered flows that exceed 400 lines of XML, or any flow that contains more than 3 `<loops>` elements.

**Why it matters:** Large, complex flows are difficult to review in a diff, difficult to debug when they fail, and carry a higher risk of hitting interview limits or governor limits at scale. Current Salesforce guidance favors focused flows with narrow entry criteria. Complex logic is better placed in Apex, which is unit-testable and governor-limit predictable.

---

#### SF-FLOW-004 — Apex Trigger and Flow Changed on the Same Object
**Severity:** 🟡 Warning

**What it checks:** Whether both a `.trigger` file and a `.flow-meta.xml` that share the same SObject were modified in the same PR.

**Why it matters:** When both Apex triggers and record-triggered flows are active on the same object, execution order matters: Apex `before` triggers run first, then `before`-save flows, then record saves, then `after`-save flows and `after` triggers. A PR that changes both sides of this interaction must be reviewed for duplicated logic, conflicting field assignments, and cascading DML interactions.

---

#### SF-FLOW-005 — New Field Without Automation Impact Review
**Severity:** 🔵 Notice

**What it checks:** Whether a new `.field-meta.xml` was added to an object that also has a `.flow-meta.xml` change in the same PR.

**Why it matters:** Adding a field to an object that has existing flows may require those flows to be updated — for example, to include the new field in a Create Records element, a screen component, or a decision condition. This rule prompts reviewers to verify the interaction rather than discover it in production.

---

### Metadata & Deployment Rules

---

#### SF-META-001 — Likely Missing Related Metadata
**Severity:** 🟡 Warning / 🔵 Notice

**What it checks:** Several common metadata dependency patterns:

| Change Detected | Missing Metadata | Severity |
|---|---|---|
| New custom field | No layout update | Warning |
| New custom tab | No App update | Notice |
| New Apex class | No Permission Set Apex access | Notice |
| New custom object | No tab or Lightning record page | Notice |

**Why it matters:** Salesforce metadata components frequently have dependencies on each other. A new field that is not added to a page layout is invisible on record pages. A new tab that is not added to an app never appears in navigation. Catching these gaps at PR review time avoids a follow-up deployment to fix missing access or visibility.

---

#### SF-META-002 — Destructive or Rename-Risk Metadata Changes
**Severity:** 🟡 Warning

**What it checks:**
1. The presence of `destructiveChanges.xml`, `destructiveChangesPre.xml`, or `destructiveChangesPost.xml` manifests.
2. Metadata files with `status: removed` — source-tracked components deleted from the repository.
3. Files with `status: renamed` — Salesforce does not rename components; the old name must be explicitly destroyed.

**Why it matters:** Deletions in Salesforce are irreversible for some component types (custom fields, for example, have a 15-day recovery window but lose data permanently). Renames that are not accompanied by a destructive manifest leave the old component in the org alongside the new one, causing confusion and potential duplicate-automation issues.

---

#### SF-META-003 — Large Profile Diff
**Severity:** 🔵 Notice

**What it checks:** Whether a `.profile-meta.xml` file has more than 100 changed lines (additions + deletions combined).

**Why it matters:** Profile XML files are notoriously large and difficult to merge. A large profile diff is hard to peer-review meaningfully — it is nearly impossible to spot a single dangerous permission being added among hundreds of field-permission lines. Large profile changes also have a high merge-conflict rate in team environments. This rule flags large diffs for extra scrutiny and encourages migrating access to Permission Sets to reduce profile file size over time.

---

#### SF-META-004 — Labels and Translations Not Updated
**Severity:** 🔵 Notice

**What it checks:** Whether user-facing metadata was changed (object definitions, custom fields, tabs, apps, page layouts) without a corresponding update to `.labels-meta.xml` or `.translation-meta.xml` files.

**Why it matters:** In multilingual orgs or managed packages, all user-visible labels are maintained in translation files. A renamed field or object that is not reflected in the translation file will display the untranslated API name to users in non-default languages. This rule is advisory — not all projects use translations — but it is a high-value catch when they do.

---

#### SF-META-005 — Mixed Concerns in One PR
**Severity:** 🔵 Notice

**What it checks:** Whether the PR touches more than 5 distinct metadata families simultaneously (Apex, LWC, Aura, flows, profiles, permission sets, object definitions, fields, layouts, reports, dashboards, static resources, etc.).

**Why it matters:** A PR that mixes data model changes, UI changes, security changes, and automation changes is harder to review, harder to roll back, and more likely to cause merge conflicts. If the production deployment fails, it is also harder to identify which change caused the failure. This rule encourages splitting large, multi-concern PRs into focused, independently deployable increments.

---

## Severity Model

| Severity | Icon | Meaning | Examples |
|---|---|---|---|
| `failure` | 🔴 | Must be fixed. Poses a direct runtime, security, or data risk. | SOQL in loop, DML in loop, hardcoded org ID, high-risk permission granted, insecure LWC DOM pattern |
| `warning` | 🟡 | Should be reviewed and addressed. High-confidence quality signal. | No test class updated, profile changed, trigger has logic, new field without permission set, apex/flow on same object |
| `notice` | 🔵 | Advisory. Low-noise informational signal for the reviewer. | Flow changed, large profile diff, mixed concerns, translation review reminder |

The review is posted as **❌ Action Required** if any failure exists. If only warnings and notices are present, the heading shows **⚠️ Warnings**. If all checks pass, the review body reads **✅ No issues found**.

---

## File Structure

```
.github/scripts/
├── package.json
├── review.js                                ← main orchestrator
├── utils/
│   └── diffParser.js                        ← diff → line number mapping
└── rules/
    ├── apex/
    │   ├── noSoqlInLoops.js                 ← SF-APEX-001
    │   ├── noDmlInLoops.js                  ← SF-APEX-002
    │   ├── bulkifiedLogic.js                ← SF-APEX-003
    │   ├── apexTestChanged.js               ← SF-APEX-004
    │   ├── noHardcodedIds.js                ← SF-APEX-005
    │   ├── broadCatchRule.js                ← SF-APEX-006
    │   └── nonSelectiveQuery.js             ← SF-APEX-007
    ├── trigger/
    │   ├── oneTriggerPerObject.js           ← SF-TRIG-001
    │   ├── triggerLogicRule.js              ← SF-TRIG-002
    │   └── recursionGuard.js               ← SF-TRIG-003
    ├── security/
    │   ├── preferPermissionSets.js          ← SF-SEC-001
    │   ├── newFieldNeedsPermset.js          ← SF-SEC-002
    │   ├── sensitivePerms.js                ← SF-SEC-003
    │   └── lwcInsecureDom.js               ← SF-SEC-004
    ├── lwc/
    │   ├── lwcNoHardcodedUrls.js           ← SF-LWC-001
    │   ├── lwcNavigation.js                ← SF-LWC-002
    │   ├── lwcDomManipulation.js           ← SF-LWC-003
    │   ├── lwcHardcodedLabels.js           ← SF-LWC-004
    │   └── lwcApexCallPattern.js           ← SF-LWC-005
    ├── flow/
    │   ├── flowReviewRequired.js           ← SF-FLOW-001
    │   ├── flowNamingRule.js               ← SF-FLOW-002
    │   ├── largeFlowRule.js                ← SF-FLOW-003
    │   ├── apexFlowSameObject.js           ← SF-FLOW-004
    │   └── fieldFlowImpact.js              ← SF-FLOW-005
    └── metadata/
        ├── missingDependencies.js          ← SF-META-001
        ├── destructiveChanges.js           ← SF-META-002
        ├── profileLargeDiff.js             ← SF-META-003
        ├── labelsTranslations.js           ← SF-META-004
        └── mixedConcerns.js               ← SF-META-005
```

---

## Adding a New Rule

### 1. Create the rule file

Create a new `.js` file in the appropriate `rules/` subdirectory. The file must export a single default function.

```javascript
// .github/scripts/rules/apex/myNewRule.js

export default function myNewRule(files, allFiles) {
  const findings = [];

  for (const file of files) {
    // Filter to relevant file types
    if (!file.content || !file.filename.endsWith('.cls')) continue;

    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (/pattern-to-detect/.test(trimmed)) {
        findings.push({
          ruleId: 'SF-APEX-008',
          severity: 'warning',           // 'failure' | 'warning' | 'notice'
          path: file.filename,
          startLine: i + 1,              // 1-indexed
          endLine: i + 1,
          message: 'Describe what was detected and why it is a problem.',
          suggestion: 'Describe specifically how to fix it.',
        });
      }
    }
  }

  return findings;
}
```

### 2. Register the rule in review.js

Add the import and include the function in the `RULES` array:

```javascript
// At the top of review.js
import myNewRule from './rules/apex/myNewRule.js';

// In the RULES array
const RULES = [
  // ...existing rules...
  myNewRule,
];
```

### Rule Function Contract

| Parameter | Type | Description |
|---|---|---|
| `files` | `Array` | Changed files in the PR, each with `.filename`, `.status`, `.content`, `.patch`, `.additions`, `.deletions` |
| `allFiles` | `Array` | Same array (available for cross-file rules that need to check multiple paths simultaneously) |

| Finding Field | Type | Required | Description |
|---|---|---|---|
| `ruleId` | `string` | Yes | Unique rule identifier (e.g., `SF-APEX-008`) |
| `severity` | `string` | Yes | `'failure'`, `'warning'`, or `'notice'` |
| `path` | `string \| null` | Yes | File path relative to repo root, or `null` for repo-level findings |
| `startLine` | `number \| null` | Yes | 1-indexed line number, or `null` for file-level findings |
| `endLine` | `number \| null` | Yes | 1-indexed end line (can equal `startLine` for single-line findings) |
| `message` | `string` | Yes | What was detected and why it matters |
| `suggestion` | `string` | No | How to fix it |

### Rule ID Conventions

| Prefix | Domain |
|---|---|
| `SF-APEX-` | Apex classes and triggers |
| `SF-TRIG-` | Trigger architecture patterns |
| `SF-SEC-` | Security and access control |
| `SF-LWC-` | Lightning Web Components |
| `SF-FLOW-` | Flow and automation |
| `SF-META-` | Metadata and deployment safety |

---

## Troubleshooting

### `Invalid keyData` — token generation fails

The `GH_APP_PRIVATE_KEY` secret is malformed. Most common causes:

1. **Newlines stripped** — the key was pasted as a single line. Delete and re-create the secret by pasting the full `.pem` file content with all line breaks preserved.
2. **Wrong format** — the key begins with `-----BEGIN PRIVATE KEY-----` (PKCS#8). Convert it: `openssl rsa -in key.pem -out converted.pem` and store `converted.pem`.
3. **Wrong secret value** — `GH_APP_ID` must contain only the numeric App ID, with no quotes or spaces.

---

### `Resource not accessible by integration` — 403 on review post

The GitHub App installation does not have the required permissions approved.

1. Go to **github.com/settings/apps/salesforce-pr-review-bot → Permissions & events**.
2. Ensure **Pull requests** is set to **Read and write**.
3. Go to **github.com/settings/installations**, find the bot, and click **Review request** to approve the updated permissions.

---

### Review posted but no inline comments

Inline comments can only be placed on lines that appear in the PR diff. If all findings are on lines that were not changed in this PR (e.g., a rule that always flags line 1), all findings will appear in the summary table in the review body rather than as inline comments. This is expected behaviour.

---

### Rule fires incorrectly / false positive

Each rule uses regular expressions rather than a full AST parser. This is intentional — it keeps the bot dependency-free and fast, but it means complex code patterns (deeply nested blocks, multi-line expressions) may not always be detected correctly.

To suppress a known false positive for a specific line, the recommended approach is to add an inline suppression comment in the Apex source and document the justification in the PR description. A future enhancement could add a `// sf-review-disable SF-APEX-001` suppression mechanism.

---

### Script finds 0 findings on every PR

Verify that:
1. The PR actually contains files matching the expected extensions (`.cls`, `.trigger`, `.flow-meta.xml`, etc.).
2. The `HEAD_SHA` environment variable is set correctly in the workflow — this is the commit ref used to fetch file content.
3. File content is being fetched successfully by checking the `Changed files:` count in the workflow log. If content is `null`, the `getFileContent` call is failing silently.
