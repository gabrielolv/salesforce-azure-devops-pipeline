# Release & Rollback Guide

## Overview

This document defines the release management and rollback procedures for the Salesforce GitHub Actions pipeline. It covers single-feature reverts, full release rollbacks, and Salesforce DevOps best practices.

The pipeline uses a **delta deployment model** powered by `sfdx-git-delta`. Every deployment is computed as the diff between the last successful commit and the current one — which means **rollback is achieved by redeploying a prior known-good state**, not by running a dedicated undo operation.

---

## Branch Strategy

```
feature/*  ──┐
bug/*      ──┤
hotfix/*   ──┤──► develop ──► qa ──► stage ──► main ──► sfprod
chore/*    ──┤
refactor/* ──┘
```

| Branch | Org | Deployment | Approval |
|--------|-----|------------|----------|
| `develop` | sfdev | Automatic | No |
| `qa` | sfqa | Automatic | No |
| `stage` | sfstage | Automatic | No |
| `main` | sfprod | Automatic after approval | **Yes — required** |

---

## Release Process

### 1. Create the Release Branch

When all features approved for a release are merged into `stage` and validated, create a release branch from `main`:

```bash
git checkout main
git pull origin main
git checkout -b release/v<version>   # e.g. release/v2025.04
```

### 2. Individual Feature Commits — REQUIRED

> **Critical rule:** every feature merged into the release branch **must be a separate, atomic commit**. Do not squash multiple features into one commit. This is what enables per-feature rollback.

Cherry-pick each feature individually from `stage`:

```bash
# Cherry-pick each feature by its merge commit hash, one at a time
git cherry-pick <commit-hash-feature-A>
git cherry-pick <commit-hash-feature-B>
git cherry-pick <commit-hash-feature-C>
```

Naming convention for commit messages on the release branch:

```
feat(<jira-id>): <short description of feature>

Examples:
feat(SF-1042): add account scoring field and validation rule
feat(SF-1087): update opportunity close date flow logic
fix(SF-1101): correct profile permission for contract object
```

Using a consistent prefix + ticket ID makes it trivial to identify which commit contains which feature, which is essential for targeted rollbacks.

### 3. Validate Before Merging to Main

Open a Pull Request from `release/v<version>` → `main`. The PR triggers:

1. Dry-run validation with targeted tests (fast feedback)
2. Dry-run validation with all local tests (regression check)
3. **Manual approval** from a designated reviewer

The PR must not be merged until both validations pass and approval is granted.

### 4. Merge to Main and Deploy

After approval, merge the PR into `main`. The `sfprod.yml` workflow triggers automatically:

1. Pre-deployment Apex scripts run (`.github/pre-deployment/*.apex`)
2. Delta package deployed to production (`RunLocalTests`, 75% minimum coverage)
3. Post-deployment Apex scripts run (`.github/post-deployment/*.apex`)

---

## Rollback Procedures

### Understanding How Rollback Works

The pipeline's `get-last-successful-commit` action tracks the last successful run. The `commit_hash` parameter on a manual workflow dispatch overrides this — allowing you to redeploy from any prior state.

**Rollback = manually triggering the workflow with the hash of the last known-good commit.**

The delta is recomputed from that hash to HEAD, which includes the removal of anything introduced after that point.

---

### Option A — Revert a Single Feature from Main

Use this when one specific feature must be undone while keeping all others in production.

**Step 1: Identify the commit to revert**

```bash
git log --oneline main
# Example output:
# a3f9c12 feat(SF-1101): correct profile permission for contract object
# b7e2d4a feat(SF-1087): update opportunity close date flow logic
# c1d8e55 feat(SF-1042): add account scoring field and validation rule
# 9f4a231 release/v2025.03 baseline
```

**Step 2: Create a revert commit**

```bash
git checkout main
git pull origin main
git revert <commit-hash-of-feature-to-undo> --no-commit
git commit -m "revert(SF-1042): remove account scoring field - prod issue detected"
git push origin main
```

`git revert` creates a new commit that undoes the changes of the target commit. It does **not** alter history — safe for a protected branch.

**Step 3: Approve and deploy**

The push to `main` triggers the `sfprod.yml` workflow. Since the pipeline is delta-based, only the metadata that was introduced by the reverted commit will be removed from production (destructive changes handled automatically by `sfdx-git-delta`).

Monitor the workflow run in the **Actions** tab. Pre/post deployment scripts run as normal.

**Step 4: Back-propagate the revert**

```bash
git checkout stage && git merge main
git push origin stage

git checkout qa && git merge stage
git push origin qa

git checkout develop && git merge qa
git push origin develop
```

This keeps all environments consistent so the reverted feature does not re-appear in the next release.

---

### Option B — Full Release Rollback

Use this when the entire release must be undone and production must return to its previous state.

**Step 1: Identify the last stable commit on main**

```bash
git log --oneline main
# Find the commit just before the release merge, e.g.:
# 9f4a231 release/v2025.03 baseline  ← this is the target
```

**Step 2: Revert all release commits at once**

```bash
git checkout main
git pull origin main

# Revert the range from the first release commit to HEAD
git revert <first-release-commit>..<HEAD> --no-commit
git commit -m "revert: full rollback of release/v2025.04 - [reason]"
git push origin main
```

Alternatively, use `git revert` commit-by-commit in reverse order if granularity is needed for audit purposes.

**Step 3: Manual workflow dispatch (optional — for immediate redeploy)**

If the revert commit is not enough (e.g., destructive changes need to be applied faster), trigger the workflow manually:

1. Go to **Actions** → **Deploy to sfprod** → **Run workflow**
2. Set `commit_hash` to the hash of the last stable commit (`9f4a231` in the example above)
3. The pipeline computes the delta from `9f4a231` to current HEAD and deploys, removing all metadata introduced in the failed release

**Step 4: Back-propagate and fix**

```bash
git checkout stage && git merge main && git push origin stage
git checkout qa && git merge stage && git push origin qa
git checkout develop && git merge qa && git push origin develop
```

Then create a new `release/v<version>-fix` branch once the root cause is resolved.

---

### Option C — Hotfix (Critical Production Bug Without Full Rollback)

Use this when a targeted fix to production is needed without rolling back the entire release.

```bash
git checkout main
git pull origin main
git checkout -b hotfix/SF-<id>-<short-description>

# Make the fix
git add <changed-files>
git commit -m "fix(SF-<id>): <description of fix>"
git push origin hotfix/SF-<id>-<short-description>
```

Open a PR from `hotfix/*` → `main`. After approval and successful validation, merge and let the pipeline deploy.

Back-propagate to all lower environments immediately after:

```bash
git checkout develop && git cherry-pick <hotfix-commit> && git push origin develop
git checkout qa && git cherry-pick <hotfix-commit> && git push origin qa
git checkout stage && git cherry-pick <hotfix-commit> && git push origin stage
```

---

## Pre/Post Deployment Scripts for Rollback Support

Apex scripts in `.github/pre-deployment/` and `.github/post-deployment/` execute in **alphabetical order**. Use numeric prefixes to control sequence:

```
.github/pre-deployment/
├── 01_disable_triggers.apex        # Disable triggers before deploy
├── 02_set_rollback_flag.apex       # Set a custom setting flag for monitoring

.github/post-deployment/
├── 01_enable_triggers.apex         # Re-enable triggers
├── 02_run_data_migration.apex      # Data migration after metadata is live
└── 03_notify_team.apex             # (Optional) external notification
```

For rollbacks, add corresponding reversal scripts following the same pattern. Scripts must be idempotent — running them twice must not corrupt data.

---

## Salesforce DevOps Best Practices

### Metadata & Source Control

- **Never deploy directly to production** from a developer org or via Setup UI. All production changes must flow through the pipeline.
- **All metadata must be tracked in source control.** Use `sf project retrieve start` after any declarative change (flows, layouts, validation rules) to pull it into your feature branch immediately.
- **Destructive changes require explicit tracking.** When deleting metadata, include a `destructiveChanges.xml` in your commit — the pipeline generates this automatically via `sfdx-git-delta`, but you must ensure the deletion is committed to source.
- **Do not use wildcards in package.xml for production deployments.** Use targeted manifests per deployment where possible — the delta package generated by the pipeline achieves this automatically.

### Testing

- Every Apex class must have a corresponding test class named `<ClassName>Test`. This is both a Salesforce requirement (75% coverage) and required by the `GenerateSfdxCommand.js` test discovery mechanism in this pipeline.
- Apex tests must be **data-independent**: use `@testSetup` or test factories — never rely on org data.
- LWC components must have Jest tests (`<componentName>.test.js`) alongside the component.
- Test classes must assert business logic, not just exercise code for coverage. Coverage-only tests that make no assertions will not catch regressions.
- Aim for **90%+ coverage** in production — the 75% floor is a minimum, not a target.

### Branching & Commits

- **One feature per branch, one feature per PR.** Mixing multiple tickets in a single branch makes rollback far harder.
- **Atomic commits on release branches.** Each ticket/feature must be a separate commit — this is what enables `git revert <single-commit>` for targeted rollback.
- **Never force-push protected branches** (`main`, `stage`, `qa`, `develop`). Use `git revert` to undo changes.
- **Commit messages must reference ticket IDs.** Format: `type(TICKET-ID): description`. This links code changes to business requirements and simplifies post-deployment audits.

### Deployment Safety

- **Validate before every production deployment** — the pipeline runs two dry-run passes (targeted tests + all local tests). Do not bypass by triggering the deploy job directly.
- **Schedule production deployments during low-traffic windows** (e.g., nights, weekends). The pipeline supports manual dispatch — use it to control timing.
- **Use pre-deployment scripts to disable automation** (triggers, process builders, flows) before deploying components they depend on. Re-enable in post-deployment.
- **Avoid deploying Profiles directly.** Profile metadata is brittle and org-specific. Prefer Permission Sets and Permission Set Groups which are more portable and reversible.
- **Keep `sfdx-project.json` API version current.** The source API version should match or be one version behind the current Salesforce release to avoid deprecated metadata behavior.

### Release Management

- **Maintain a CHANGELOG.** For every release branch, document what is included (ticket IDs, descriptions, expected impact). This is essential for rollback decisions.
- **Tag releases in git** after every successful production deployment:
  ```bash
  git tag -a v2025.04 -m "Release v2025.04 — see CHANGELOG"
  git push origin v2025.04
  ```
  Tags serve as safe, named rollback targets for manual workflow dispatch.
- **Do not accumulate features in a release branch.** Release branches are short-lived. If a feature is not ready, do not include it — leave it in `stage` for the next release.
- **Back-propagate all production merges immediately.** After any merge to `main` (including hotfixes and reverts), merge back to `stage` → `qa` → `develop` before the next sprint starts.

### Org Hygiene

- **Keep sandbox refreshes on a schedule.** `stage` and `qa` sandboxes should be refreshed from production at least once per quarter to prevent configuration drift.
- **Document manual org-only changes.** If any change must be made directly in an org (e.g., activating a feature flag, loading reference data), log it immediately in the team's change log and create a corresponding automation or script for future deploys.
- **Use Custom Metadata Types instead of Custom Settings for configuration data** that must be deployed — Custom Metadata is deployable via metadata API; Custom Settings data is not.

---

## Quick Reference

| Scenario | Action | Command / Steps |
|----------|--------|-----------------|
| Single feature broke prod | Revert one commit | `git revert <hash>` → push → approve pipeline |
| Entire release must be undone | Revert range | `git revert <first>..<HEAD>` → push → approve pipeline |
| Urgent fix without rollback | Hotfix branch | `hotfix/*` → PR → merge to main → cherry-pick down |
| Redeploy a known-good state | Manual dispatch | Actions → Run workflow → set `commit_hash` |
| Emergency — skip delta | Manual dispatch | Set `commit_hash` to baseline → full recompute |

---

## Rollback Decision Checklist

Before executing any rollback, confirm:

- [ ] Is the issue isolated to one feature or the entire release?
- [ ] Is the affected metadata tracked in source control (was it deployed via the pipeline)?
- [ ] Are there active data records that depend on the metadata being reverted (e.g., flow records, picklist values in use)?
- [ ] Are pre/post deployment scripts required to safely undo this change?
- [ ] Has the QA team been notified of the rollback?
- [ ] Is the rollback scheduled for a safe deployment window?
- [ ] Will a revert to the previous state also affect active integrations or connected systems?

> **Note on data impact:** Salesforce metadata rollbacks do not undo data changes. If a deployed flow created records or a field migration moved data, the metadata revert will not reverse that data. Assess data impact before executing any rollback and prepare a separate data correction plan if needed.
