# Salesforce CI/CD Pipeline Guide

## Table of Contents
1. [Overview](#overview)
2. [Environment Architecture](#environment-architecture)
3. [Branch Strategy & Naming Conventions](#branch-strategy--naming-conventions)
4. [Pipeline Flow](#pipeline-flow)
5. [Why Run Tests in Develop First](#why-run-tests-in-develop-first)
6. [Pre & Post Deployment Scripts](#pre--post-deployment-scripts)
7. [Delta Deployments](#delta-deployments)
8. [Code Quality & Local Development](#code-quality--local-development)
9. [Salesforce DevOps Best Practices](#salesforce-devops-best-practices)
10. [Getting Started](#getting-started)

---

## Overview

This project uses a **GitFlow-based CI/CD pipeline** powered by GitHub Actions to automate Salesforce deployments across four environments. Every push to a protected branch triggers an automated validate-then-deploy workflow, ensuring code is tested before it reaches production.

```
Developer Machine → develop → qa → stage → main (Production)
```

---

## Environment Architecture

| Branch    | Salesforce Org | Approval Required | Purpose                          |
|-----------|---------------|-------------------|----------------------------------|
| `develop` | sfdev         | No                | Integration of all developer work |
| `qa`      | sfqa          | No                | QA / business user testing        |
| `stage`   | sfstage       | No                | UAT / pre-production validation   |
| `main`    | sfprod        | **Yes**           | Production                        |

Each branch maps 1-to-1 to a Salesforce org. Only the production deployment requires a manual approval gate, configured as a GitHub Environment protection rule.

---

## Branch Strategy & Naming Conventions

### Protected Branches

The following branches are **permanent** and represent live environments. Direct commits should never be made to them — all changes must arrive via Pull Request:

- `main` — Production
- `stage` — Staging / UAT
- `qa` — Quality Assurance
- `develop` — Integration / Development

### Working Branches

Always branch off from `develop` and follow these naming prefixes:

| Prefix       | Use Case                                          | Example                               |
|--------------|---------------------------------------------------|---------------------------------------|
| `feature/`   | New functionality or enhancements                 | `feature/opportunity-stage-automation`|
| `bug/`       | Bug fixes for issues found in develop or qa       | `bug/contact-trigger-null-pointer`    |
| `hotfix/`    | Critical fixes that must go directly to main      | `hotfix/login-page-crash`             |
| `release/`   | Release preparation and final adjustments         | `release/v2.3.0`                      |
| `chore/`     | Non-functional changes (config, tooling, docs)    | `chore/update-api-version`            |
| `refactor/`  | Code restructuring without behavior changes       | `refactor/account-trigger-handler`    |

### Branch Lifecycle

```
develop
  └── feature/my-new-feature     ← created from develop
        └── [work, commits]
        └── Pull Request → develop
              └── [pipeline validates & deploys to sfdev]
              └── Pull Request → qa
                    └── [pipeline validates & deploys to sfqa]
                    └── Pull Request → stage
                          └── [pipeline validates & deploys to sfstage]
                          └── Pull Request → main  ← requires approval
                                └── [pipeline deploys to sfprod]
```

**Why this matters:** Each Pull Request gives the team visibility over what is changing, an opportunity to do code review, and a safety checkpoint before the pipeline runs. Bypassing this with direct pushes removes all of those safeguards.

---

## Pipeline Flow

Each environment workflow follows the same two-job pattern:

### Job 1 — Build & Validate

```
1. Install Salesforce CLI (Node.js 24)
2. Retrieve the last successful deployment commit hash
3. Generate a delta package (only changed components since last deploy)
4. Authenticate to the target Salesforce org
5. Check-deploy with specific tests matched to changed code  [dry-run]
6. Check-deploy with all local tests                         [dry-run]
```

The two check-deploy steps are both dry runs — nothing is deployed yet. They exist to catch errors early and guarantee that:
- The delta package is valid.
- The changed code is covered by at least one test class.
- All local tests still pass with the new code.

### Job 2 — Deploy (depends on Job 1 passing)

```
1. Run pre-deployment Apex scripts  (.github/pre-deployment/*.apex)
2. Deploy delta to Salesforce org   (RunLocalTests)
3. Run post-deployment Apex scripts (.github/post-deployment/*.apex)
```

### Manual Trigger

Every workflow can be triggered manually from the GitHub Actions UI. You can optionally supply a specific commit hash to redeploy from a known-good point — useful when recovering from a partially failed deployment.

### Production Approval Gate

The `sfprod` workflow uses a GitHub Environment with **Required Reviewers**. The deploy job will pause after validation and wait for an authorized team member to approve before any changes reach production. This is the last line of defense against unintended production changes.

---

## Why Run Tests in Develop First

Running test classes in `develop` before promoting to higher environments is one of the most important disciplines in a Salesforce DevOps pipeline. Here is why:

### 1. Catch Errors at the Lowest Cost

The further a bug travels through the pipeline, the more expensive it becomes to fix. A bug caught in `develop` is fixed by one developer in minutes. The same bug caught in `stage` may require coordination across QA, developers, and business stakeholders — and may block an entire release.

```
Cost to fix:  develop << qa << stage <<< production
```

### 2. Apex Test Coverage Is a Deployment Gate

Salesforce requires **75% Apex code coverage** to deploy to production. If coverage drops below that threshold, the production deployment fails — even if every other step worked. Running `RunLocalTests` in `develop` enforces this gate at the earliest stage, so the team is never surprised on release day.

### 3. Delta Deployments Can Break Existing Coverage

This pipeline uses delta deployments — only the files that changed since the last deployment are included. A change to a trigger or a utility class can reduce coverage for classes that were not even modified. Running all local tests in `develop` catches these indirect coverage regressions before they compound across environments.

### 4. Tests Validate Business Logic, Not Just Syntax

Apex tests are not just a formality for Salesforce's governor limits — they are the executable specification of business logic. A passing test suite in `develop` means the feature behaves as designed. A failing test is the pipeline's way of saying: "something you changed broke an existing contract."

### 5. This Pipeline Already Does It For You

The `build-and-validate` job automatically:
- Identifies which test classes map to the changed components using `GenerateSfdxCommand.js`.
- Runs those specific tests first to get fast feedback on the changed code.
- Then runs all local tests to catch regressions in unmodified code.

This means developers get targeted test results quickly and comprehensive coverage assurance before any real deployment happens.

---

## Pre & Post Deployment Scripts

The pipeline supports automated Apex script execution around each deployment.

### Pre-Deployment (`.github/pre-deployment/`)

Scripts here run **before** the metadata is deployed. Use them to prepare the org:

- Disable process builders, flows, or triggers that would fail on partial data states.
- Create required reference data that deployed code depends on.
- Set configuration flags to put the org in a safe deployment state.

### Post-Deployment (`.github/post-deployment/`)

Scripts here run **after** the metadata is deployed. Use them to activate and finalize:

- Re-enable triggers, flows, and automations that were disabled.
- Run data migrations or transformations required by schema changes.
- Activate new features or permission sets.

Scripts in both folders are discovered automatically by filename and executed in **alphabetical order**. Name them with a numeric prefix to control order explicitly:

```
.github/pre-deployment/
  01_disable_account_trigger.apex
  02_disable_opportunity_flow.apex

.github/post-deployment/
  01_enable_opportunity_flow.apex
  02_enable_account_trigger.apex
  03_send_deployment_notification.apex
```

---

## Delta Deployments

Instead of deploying the entire `force-app` directory every time, this pipeline uses **sfdx-git-delta** to compute the diff between the last successful deployment commit and the current commit. Only changed components are included in the deployment package.

### Benefits

- **Faster deployments** — fewer components means fewer tests to run and less time in the deploy queue.
- **Reduced risk** — touching fewer components reduces the surface area for unexpected side effects.
- **Accurate destructive changes** — deleted metadata is automatically included in a `destructiveChanges.xml`, so stale components are cleaned from the org.

### How the Baseline Works

The `get-last-successful-commit` action queries the GitHub API for the last run of the current branch's workflow that completed successfully. The very first time a branch is used, you must run the `first-run-baseline` workflow manually to seed that history. After that, the baseline updates automatically with each successful deploy.

---

## Code Quality & Local Development

This project enforces code quality standards at the developer's machine before code even reaches GitHub, using pre-commit hooks via Husky and lint-staged.

### What Runs on Every Commit

| Tool       | Files Checked                                              | What It Does                            |
|------------|------------------------------------------------------------|-----------------------------------------|
| Prettier   | `.cls`, `.trigger`, `.html`, `.js`, `.xml`, `.json`, etc.  | Enforces consistent formatting          |
| ESLint     | LWC and Aura `.js` files                                   | Catches JavaScript quality issues        |
| Jest       | LWC test files (`__tests__/`)                              | Runs unit tests for changed components  |

If any of these checks fail, the commit is blocked. Fix the issue, stage the corrected files, and commit again.

### Running Checks Manually

```bash
# Format all files
npm run prettier

# Verify formatting without changing files
npm run prettier:verify

# Run ESLint
npm run lint

# Run all LWC unit tests
npm run test:unit

# Run tests with coverage report
npm run test:unit:coverage
```

### VS Code Integration

The project includes VS Code settings and recommended extensions (`.vscode/extensions.json`). Installing the recommended extensions gives you:

- Inline ESLint feedback as you type.
- Format-on-save via Prettier.
- Salesforce CLI integration for push/pull and org authentication.

---

## Salesforce DevOps Best Practices

### 1. Never Develop Directly in a Shared Org

Each developer should work in a **scratch org** or a **developer sandbox** and use `sf project deploy start` / `sf project retrieve start` to sync with source control. Developing directly in a shared org leads to undocumented changes, conflicts, and deployments that cannot be reproduced from source.

### 2. Keep Branches Short-Lived

A feature branch that lives for weeks accumulates drift from `develop` and becomes increasingly painful to merge. Aim to merge feature branches within **3–5 days**. Break large features into smaller, independently deployable increments.

### 3. Always Write a Test Class With Your Apex

Every Apex class and trigger should have a corresponding test class before the Pull Request is opened — not as an afterthought. The test class name convention used by this pipeline's `GenerateSfdxCommand.js` is `{ClassName}Test` (e.g., `AccountHandlerTest` for `AccountHandler`). Following this convention ensures automatic test selection works correctly.

### 4. Use `@TestSetup` for Shared Test Data

Avoid creating test data inside individual `@isTest` methods. Use `@TestSetup` to create shared data once per test class execution. This reduces test execution time and makes test data setup easier to maintain.

```apex
@isTest
private class AccountHandlerTest {
    @TestSetup
    static void makeData() {
        insert new Account(Name = 'Test Account');
    }

    @isTest
    static void testMyMethod() {
        Account acc = [SELECT Id FROM Account LIMIT 1];
        // test logic here
    }
}
```

### 5. Use `@SeeAllData=false` (the Default)

Never use `@isTest(SeeAllData=true)` unless absolutely required for a specific use case (e.g., certain CPQ tests). Tests that read live org data are fragile — they pass in one environment and fail in another because the data is different. Rely exclusively on data created in `@TestSetup` or within the test method itself.

### 6. Meaningful Commit Messages

Write commit messages that explain **why** the change was made, not just what file was touched. The pipeline uses commit hashes to compute deltas — a clear commit history makes it easier to audit what was deployed when.

```
# Bad
fix bug

# Good
fix null pointer in AccountTrigger when billing address is blank
```

Consider following [Conventional Commits](https://www.conventionalcommits.org/) for consistency:

```
feat: add opportunity stage change notification
fix: prevent duplicate contact creation on lead convert
chore: update API version to 66.0
```

### 7. Validate Locally Before Pushing

Before pushing to a branch and triggering a pipeline run, validate your changes against a scratch org or sandbox locally:

```bash
# Validate without deploying
sf project deploy validate --manifest manifest/package.xml --test-level RunLocalTests

# Deploy to your personal sandbox
sf project deploy start --manifest manifest/package.xml --test-level RunLocalTests
```

This catches obvious errors before consuming pipeline minutes and blocking other developers.

### 8. Never Delete Metadata Directly in an Org

If a component needs to be removed, delete it from the source repository and let the pipeline deploy the `destructiveChanges.xml` that sfdx-git-delta generates automatically. Deleting metadata manually in an org creates a mismatch between the org state and source control — the next delta deployment may attempt to deploy a component that references the deleted one, causing failures.

### 9. Gate Production With More Than Automation

The pipeline's approval gate for production is a checkpoint, not a rubber stamp. The reviewer should:

- Confirm the correct changes are in scope by reviewing the Pull Request diff.
- Verify that QA and Stage deployments succeeded without errors.
- Confirm there is no active Salesforce maintenance window.
- Check that pre/post deployment scripts have been reviewed if they were added or modified.

### 10. Monitor Deployment Logs

After each deployment, review the GitHub Actions run logs for warnings — even when the deployment succeeds. Salesforce will sometimes warn about deprecated API usage, components approaching governor limits, or test classes with low coverage margins. These warnings are tomorrow's failures if ignored.

### 11. Keep API Version Up to Date

The project currently targets **API version 66.0**. As Salesforce releases new API versions (three times per year), update `sfdx-project.json` and `manifest/package.xml` in a dedicated `chore/` branch. Staying current ensures access to new platform features and avoids deprecation issues.

### 12. Use Environments for Secret Management

Org credentials (username, password, client ID, client secret) are stored as **GitHub Environment secrets** — one set per environment (`sfdev`, `sfqa`, `sfstage`, `sfprod`). Never commit credentials to the repository. Rotate secrets immediately if they are ever accidentally exposed.

---

## Getting Started

### Initial Setup (First Time Per Branch)

1. Configure your Salesforce org credentials as GitHub Environment secrets for the target environment.
2. Run the `first-run-baseline` workflow manually, selecting the branch you want to initialize.
3. Push a change to the branch — the pipeline will now compute deltas from that baseline forward.

### Starting a New Feature

```bash
# 1. Get the latest develop
git checkout develop
git pull origin develop

# 2. Create your feature branch
git checkout -b feature/your-feature-name

# 3. Develop, test locally, commit
git add force-app/...
git commit -m "feat: describe your change"

# 4. Push and open a Pull Request to develop
git push origin feature/your-feature-name
```

### Promoting to Higher Environments

After a feature is merged to `develop` and the sfdev deployment is green, open Pull Requests in sequence:

```
develop → qa → stage → main
```

Each merge triggers the corresponding environment's pipeline automatically. Do not skip environments — a change that was never validated in QA or Stage has no business being approved for production.
