# Salesforce DevOps Pipeline

A multi-CI Salesforce DevOps toolkit supporting both **GitHub Actions** and **Azure DevOps**. It covers delta-based metadata deployments, Vlocity/OmniStudio managed-package deployments, dynamic Apex test selection, JWT authentication, pre/post deployment scripts, and an automated PR review bot for Salesforce best practices.

---

## Overview

This repository provides:

- **Deployment pipelines** for multiple Salesforce environments (Dev, QA, Stage, Pre-Prod, Prod) on both GitHub Actions and Azure DevOps.
- **Delta-based deployments** via `sfdx-git-delta` — only changed metadata is deployed.
- **Vlocity/OmniStudio support** — parallel deployment track for managed-package Omni Studio components (OmniScript, DataRaptor, IntegrationProcedure, FlexiCard, etc.) stored as JSON datapacks.
- **Dynamic test selection** — a Node.js script reads `package.xml` and runs only the relevant Apex test classes.
- **JWT Bearer Flow authentication** — no passwords stored; uses Connected App + private key.
- **Pre/post deployment Apex scripts** — run anonymous Apex before and after each deployment.
- **Salesforce PR Review Bot** — automated two-layer PR reviewer: 30+ deterministic static rules plus a Claude Sonnet AI agent that enforces Salesforce best practices and analyses cross-repo impact (e.g. trigger conflicts, flow ↔ Apex dual-automation, broken field references).

---

## Repository Structure

```
.azure/
├── pipelines/
│   ├── sfdev-azure-pipelines.yml       # Azure: Dev org (branch: develop)
│   ├── sfqa-azure-pipelines.yml        # Azure: QA org (branch: qa)
│   ├── sfuat-azure-pipelines.yml       # Azure: UAT org (branch: uat)
│   ├── sfpstage-azure-pipelines.yml    # Azure: Stage org (branch: stage)
│   ├── sfprod-azure-pipelines.yml      # Azure: Prod org (branch: main)
│   ├── azure-pipelines-without-destructive-package.yml
│   ├── GenerateSfdxCommand.js
│   └── templates/
│       ├── install-sf-cli.yml
│       ├── install-plugin.yml
│       ├── get-commit-hash.yml
│       ├── get-last-successful-commit.yml
│       ├── generate-delta.yml
│       ├── sf-login.yml
│       ├── sf-check-deploy.yml
│       ├── sf-deploy.yml
│       └── run-scripts.yml
├── scripts/
│   ├── pre-deployment/
│   └── post-deployment/

.github/
├── workflows/
│   ├── sfdev.yml                   # GitHub Actions: Dev org (branch: develop)
│   ├── sfqa.yml                    # GitHub Actions: QA org (branch: qa)
│   ├── sfstage.yml                 # GitHub Actions: Stage org (branch: stage)
│   ├── sfprod.yml                  # GitHub Actions: Prod org (branch: main)
│   ├── sfpreprodvalidation.yml     # GitHub Actions: Pre-prod validation only
│   ├── salesforce-pr-review.yml    # GitHub Actions: PR Review Bot
│   ├── first-run-baseline.yml      # One-time baseline setup
│   └── GenerateSfdxCommand.js
├── actions/
│   ├── install-sf-cli/
│   ├── install-plugin/
│   ├── get-last-successful-commit/
│   ├── generate-delta/
│   ├── sf-login/
│   ├── sf-check-deploy/
│   ├── sf-deploy/
│   ├── vlocity-deploy/             # Vlocity datapack deploy/delete composite action
│   └── run-scripts/
├── scripts/
│   ├── vlocity-delta.sh            # Detects changed Vlocity component directories
│   ├── vlocity-build-jobfile.sh    # Generates Vlocity Build Tool job YAML from manifest
│   ├── review.js                   # PR review bot entry point (merges static + AI findings)
│   ├── ai-review.js                # Claude Sonnet AI review layer (cross-repo impact analysis)
│   ├── utils/diffParser.js
│   └── rules/
│       ├── apex/
│       ├── trigger/
│       ├── lwc/
│       ├── flow/
│       ├── security/
│       └── metadata/
├── pre-deployment/
└── post-deployment/

vlocity/                            # Vlocity datapack exports (one subdirectory per component type)
├── OmniScript/
├── DataRaptor/
├── IntegrationProcedure/
├── FlexiCard/
└── ...
```

---

## CI Platform Support

Both platforms implement the same two-stage pattern: **validate → deploy**.

| Platform | Config location | Auth | Reusable units |
|---|---|---|---|
| GitHub Actions | `.github/workflows/` | JWT Bearer Flow | Composite actions (`.github/actions/`) |
| Azure DevOps | `.azure/pipelines/` | JWT Bearer Flow | YAML templates (`.azure/pipelines/templates/`) |

---

## Deployment Pipelines

### Environment mapping

| Salesforce Org | Branch | GitHub Actions workflow | Azure DevOps pipeline |
|---|---|---|---|
| Dev | `develop` | `sfdev.yml` | `sfdev-azure-pipelines.yml` |
| QA | `qa` | `sfqa.yml` | `sfqa-azure-pipelines.yml` |
| Stage | `stage` | `sfstage.yml` | `sfpstage-azure-pipelines.yml` |
| Pre-Prod (validation only) | `pre-prod-validation` | `sfpreprodvalidation.yml` | — |
| Prod | `main` | `sfprod.yml` | `sfprod-azure-pipelines.yml` |

### Stage 1 — Build & Validation

1. Checkout repository (full history)
2. Install Salesforce CLI
3. Resolve the target commit hash (manual override or last successful run)
4. Install `sfdx-git-delta` plugin
5. Generate delta package between commits
6. Detect changed Vlocity components (`vlocity-delta.sh`) and set `has_changes` output
7. Generate dynamic Apex test command via `GenerateSfdxCommand.js`
8. Authenticate to Salesforce via JWT Bearer Flow
9. Validate deployment with targeted tests (dry-run)
10. Validate deployment running all Apex tests (dry-run)

Two outputs control the deployment stage:

| Output | Value | Meaning |
|---|---|---|
| `nothing_to_deploy` | `true` | No SF metadata **and** no Vlocity changes — deployment job skipped entirely |
| `sf_nothing_to_deploy` | `true` | No SF metadata changes — `sf project deploy` step skipped, Vlocity deploy still runs |

### Stage 2 — Deployment

Runs only after Stage 1 passes and `nothing_to_deploy` is not `true`. For Prod, use GitHub environment protection rules (GitHub Actions) or an approval gate (Azure DevOps) to require a manual review before deployment proceeds.

1. Checkout, install CLI & plugin
2. Regenerate delta package
3. Authenticate to Salesforce
4. Run pre-deployment Apex scripts
5. Deploy SF metadata — **skipped** if `sf_nothing_to_deploy` is `true`
6. Deploy Vlocity components via `vlocity-deploy` action — **skipped automatically** if no Vlocity changes detected
7. Run post-deployment Apex scripts

### Manual trigger / specific commit

Both platforms support `workflow_dispatch` (GitHub) or manual run (Azure DevOps) with an optional `CommitHash` input to target a specific commit range.

---

## PR Review Bot (GitHub Actions)

The `salesforce-pr-review.yml` workflow triggers on every pull request targeting `develop`. It runs a two-layer review and posts inline comments plus a summary directly on the PR.

### How it works

```
PR opened / updated
  │
  ├─► Layer 1 — Static rules (review.js + rules/)
  │     Fast, deterministic pattern-matching across 30+ rules.
  │     Always runs, zero external cost.
  │
  └─► Layer 2 — Claude Sonnet AI agent (ai-review.js)
        Reads logic files (Apex, LWC, Flows) in full.
        Reads related repo files to reason about cross-file impact.
        Posts findings that static rules structurally cannot detect.
```

Both layers produce findings in the same schema (`ruleId`, `severity`, `path`, `startLine`, `message`, `suggestion`). They are merged and posted as a single GitHub PR review — inline comments on diff lines where possible, a findings table in the review body otherwise.

- Findings from Layer 1 carry rule IDs like `SF-APEX-001`, `SF-FLOW-003`, etc.
- Findings from Layer 2 carry rule IDs prefixed `SF-AI-` and are attributed in the review footer.

### Layer 1 — Static rules

**Apex**
- No SOQL queries inside loops (`SF-APEX-001`)
- No DML operations inside loops (`SF-APEX-002`)
- Bulkified logic — collections over single-record operations
- Apex test coverage — test classes updated when production code changes
- No hardcoded record IDs
- No broad `catch (Exception e)` without re-throw
- Non-selective SOQL queries (missing indexed filter)

**Triggers**
- One trigger per object
- No business logic directly in triggers (handler pattern)
- Recursion guard required

**LWC**
- No hardcoded URLs
- Correct navigation service usage
- No direct DOM manipulation
- No hardcoded labels (use custom labels)
- Apex call patterns (wire vs imperative)

**Flow**
- Manual review required for complex flows
- Naming convention enforcement
- Large flow warning

**Security**
- Prefer Permission Sets over Profiles
- New fields must have a Permission Set
- Sensitive permissions flagged
- LWC insecure DOM usage

**Metadata**
- Destructive changes flagged
- Labels/translations consistency
- Missing dependencies
- Mixed concerns in a single PR
- Large Profile diffs

### Layer 2 — Claude Sonnet AI agent

The AI agent is a **read-only reviewer**. It is explicitly instructed never to write, generate, or suggest code changes — its sole purpose is to identify and describe issues.

**What the AI checks (beyond static rules):**

| Category | Examples |
|---|---|
| Apex / Triggers | CRUD/FLS enforcement, sharing model violations, mixed DML, async anti-patterns, silent catch blocks, test quality |
| Triggers | Logic directly in trigger body, dual-automation conflict with record-triggered flows, multiple triggers on same object |
| Flows | Fault path missing on screen flows, hardcoded IDs/record type names, null-unsafe Get Records access |
| LWC | Imperative Apex calls without error handling, stale reactive state |
| Security | New fields without FLS coverage, broad permission set grants, sensitive field types |
| Cross-repo impact | Field rename/deletion breaking other metadata, method signature change breaking callers, new validation rule breaking test data |

**Cross-repo impact analysis** is the AI layer's primary value add. When a PR changes an `AccountTrigger.cls`, the agent automatically receives:
- Other triggers on the Account object (to detect execution-order conflicts)
- Flows referencing Account (to detect dual-automation)
- The `Account.object-meta.xml` definition (for field/relationship context)

It uses this context to reason about breakage that no pattern-matching rule can catch.

### Token cost controls

The AI layer has five built-in guards to keep API costs low:

| Guard | Behaviour |
|---|---|
| Skip non-logic PRs | If the PR only touches XML metadata (profiles, translations, layouts, etc.) — Claude is never called |
| Diff-only for metadata | Non-logic files send only the git diff, not full content |
| Hard input cap | Total message is capped at ~12,500 tokens; context files are dropped until it fits |
| Output cap | `max_tokens` set to 2,048 (sufficient for 15 findings) |
| Context file limit | At most 8 related repo files are included |

Actual token usage is printed in the workflow log on every run:

```
AI review: 3 logic file(s) (7 total), 4 context file(s), ~3,200 input tokens estimated
AI review: tokens used — input: 3418, output: 612, cache_read: 820, cache_write: 0
```

Typical cost per PR on `claude-sonnet-4-6`: **$0.01 – $0.06**. XML-only PRs: **$0.00**.

### Required secrets

| Secret | Used by | Description |
|---|---|---|
| `GITHUB_TOKEN` | Both layers | Automatically provided by GitHub Actions — posts the PR review |
| `ANTHROPIC_API_KEY` | AI layer only | Anthropic API key; if absent the AI layer is silently skipped |

Add `ANTHROPIC_API_KEY` under **Settings → Secrets and variables → Actions → New repository secret**.

---

## Vlocity / OmniStudio Support

This pipeline supports orgs where Omni Studio components (OmniScript, DataRaptor, IntegrationProcedure, FlexiCard, etc.) are stored as managed-package records under the `vlocity_cmt` namespace and exported as JSON datapacks. This is the model used by orgs that adopted Vlocity before Salesforce's native Omni Studio migration.

### How it works

Deployment runs two parallel tracks:

- **Track A — Standard metadata**: `sfdx-git-delta` → `sf project deploy start` (existing flow)
- **Track B — Vlocity datapacks**: `vlocity-delta.sh` → `vlocity packDeploy` / `packDelete`

Standard metadata always deploys first, since Vlocity components frequently depend on custom fields, objects, and Apex classes that must exist in the target org before the datapacks are applied.

### Datapack directory structure

Export Vlocity components into the `vlocity/` directory at the repo root, following the standard Vlocity Build Tool layout:

```
vlocity/
├── OmniScript/
│   └── Type_SubType_Language/
│       ├── Type_SubType_Language_DataPack.json
│       └── Type_SubType_Language.json
├── DataRaptor/
│   └── ComponentName/
│       └── ComponentName_DataPack.json
├── IntegrationProcedure/
├── FlexiCard/
└── ...
```

Each component is a subdirectory two levels deep (`TYPE/ComponentName`). The delta script detects changes at this level — any file change inside a component directory marks the whole component for redeployment.

### Configuring the Vlocity root path

The default root path is `vlocity/`. If your export directory has a different name (e.g., `vlocity_cmt_DataPacks/`), update the `vlocity_root` input in each workflow's deploy step:

```yaml
- name: Deploy Vlocity components
  uses: ./.github/actions/vlocity-deploy
  with:
    vlocity_root: vlocity_cmt_DataPacks   # change to match your export directory
```

### Pinning the Vlocity Build Tool version

The `vlocity-deploy` action installs `vlocity@latest` by default. For reproducible builds, pin a specific version matching your org's managed package:

```yaml
- name: Deploy Vlocity components
  uses: ./.github/actions/vlocity-deploy
  with:
    vlocity_root: vlocity
    vlocity_version: "1.18.0"
```

### Determining your org's Omni Studio model

Run this query against any sandbox to confirm whether the managed package is installed:

```bash
sf data query \
  --query "SELECT NamespacePrefix, Name FROM ApexClass WHERE NamespacePrefix = 'vlocity_cmt' LIMIT 1" \
  --target-org <your-org-alias>
```

- **Results returned** — org uses managed-package Vlocity; this pipeline's Vlocity track applies.
- **No results** — org is on native Omni Studio; the standard metadata track handles it with no special configuration needed.

### Integration user permissions

Vlocity datapack deployments write to `vlocity_cmt__*` custom objects. The integration user's Permission Set must include Read/Create/Edit/Delete access (and View All / Modify All for record sharing) on the Vlocity-namespaced objects. Add the relevant `objectPermissions` blocks to your `CI_CD_Integration` permission set for each Vlocity object type in use.

---

## Authentication — JWT Bearer Flow

Both platforms use **JWT Bearer Flow** (no passwords). The SF CLI authenticates with:

| Secret | Description |
|---|---|
| `SF_CLIENT_ID` | Connected App Consumer Key |
| `SF_JWT_KEY` | Private key PEM contents (`server.key`) |
| `SF_USERNAME` | Salesforce username of the integration user |
| `SF_LOGIN_URL` | `https://login.salesforce.com` (prod) or `https://test.salesforce.com` (sandbox) |

Store these as **GitHub Actions environment secrets** (one environment per org) or **Azure DevOps variable groups** (one group per org).

### GitHub Actions environments

Create one environment per org in your repository settings and add the secrets above to each:

- `sfdev`
- `sfqa`
- `sfstage`
- `sfprod`

### Azure DevOps variable groups

- `sfdev`, `sfqa`, `sfuat`, `sfpstage`, `sfprod`
- `sfprod-validation` — read-only group used during the prod validation stage

---

## Pre/Post Deployment Apex Scripts

Place anonymous Apex files in:

- **GitHub Actions**: `.github/pre-deployment/` and `.github/post-deployment/`
- **Azure DevOps**: `.azure/scripts/pre-deployment/` and `.azure/scripts/post-deployment/`

All `.apex` files in those folders are executed in order using `sf apex run`. Use these for data seeding, permission assignments, or cleanup tasks that must run around a deployment.

---

## First-Run Baseline (GitHub Actions)

Before running a deployment workflow on a branch for the first time, run the `first-run-baseline` workflow manually. This creates a successful workflow run that `get-last-successful-commit` can use as the starting commit for delta generation.

1. Go to **Actions → first-run-baseline → Run workflow**.
2. Select the target branch.
3. Run the deployment workflow normally after this completes.

---

## Dynamic Test Selection — `GenerateSfdxCommand.js`

This Node.js script reads the generated `delta/package/package.xml` and searches for related test files in the project. It outputs a `--tests` flag string (`sfCommandTests`) containing only the test classes relevant to the changed metadata.

The deployment validation step then uses this output to run a targeted subset of tests before falling back to a full test run.

---

## Output

| Artifact | Description |
|---|---|
| `./delta` | Generated metadata delta package |
| `./delta/vlocity/deploy-manifest.txt` | Vlocity components detected for deployment (`TYPE/ComponentName` per line) |
| `./delta/vlocity/delete-manifest.txt` | Vlocity components detected for deletion |
| `./delta/vlocity/vlocity-deploy-job.yaml` | Generated Vlocity Build Tool job file for deployments |
| `./delta/vlocity/vlocity-delete-job.yaml` | Generated Vlocity Build Tool job file for deletions |
| `sfCommandTests` | Dynamic Apex test command string |
| Salesforce org | Deployed metadata changes (SF metadata + Vlocity datapacks) |
