# Azure DevOps Salesforce Deployment Pipeline

This repository provides a set of Azure DevOps pipelines to manage Salesforce metadata deployments through delta generation, environment-specific configurations, and test execution automation.

## Overview

This pipeline architecture allows you to:

* Perform selective deployments to Salesforce using delta detection.
* Dynamically generate test class execution commands.
* Retrieve environment-specific secrets via dedicated pipelines.
* Run per-environment pipelines, each scoped to its own branch and variable group.

---

## Repository Structure

```
pipelines/
├── sfdev-azure-pipelines.yml       # Pipeline for the Dev org (branch: develop)
├── sfqa-azure-pipelines.yml        # Pipeline for the QA org (branch: qa)
├── sfuat-azure-pipelines.yml       # Pipeline for the UAT org (branch: uat)
├── sfpstage-azure-pipelines.yml    # Pipeline for the Stage org (branch: stage)
├── sfprod-azure-pipelines.yml      # Pipeline for the Prod org (branch: main)
├── variables-pipelines.yml         # Helper pipeline to publish env variables as artifacts
├── azure-pipelines-without-destructive-package.yml  # Variant without destructive changes
└── templates/
    ├── install-sf-cli.yml
    ├── install-plugin.yml
    ├── get-commit-hash.yml
    ├── get-last-successful-commit.yml
    ├── generate-delta.yml
    ├── generate-delta-without-destructive-package.yml
    ├── sf-login.yml
    ├── sf-check-deploy.yml
    ├── sf-check-deploy-without-destructive-package.yml
    ├── sf-deploy.yml
    └── sf-deploy-without-destructive-package.yml
```

---

## Pipeline Breakdown

### 1. Per-Org Deployment Pipelines

Each Salesforce org has its own pipeline file. They all follow the same two-stage pattern:

| Pipeline file | Branch trigger | Variable group (validation) | Variable group (deploy) |
|---|---|---|---|
| `sfdev-azure-pipelines.yml` | `develop` | `sfdev` | `sfdev` |
| `sfqa-azure-pipelines.yml` | `qa` | `sfqa` | `sfqa` |
| `sfuat-azure-pipelines.yml` | `uat` | `sfuat` | `sfuat` |
| `sfpstage-azure-pipelines.yml` | `stage` | `sfpstage` | `sfpstage` |
| `sfprod-azure-pipelines.yml` | `main` | `sfprod-validation` | `sfprod` |

#### Parameters

* `CommitHash` *(optional)*: Override the target commit for delta generation. Defaults to the last successful pipeline run.

#### Stage 1 — Build & Validation (`BuildAndValidate`)

1. Checkout repository with full history
2. Install Salesforce CLI (`install-sf-cli.yml`)
3. Resolve commit hash (`get-commit-hash.yml`)
4. Retrieve last successful commit (`get-last-successful-commit.yml`)
5. Install `sfdx-git-delta` plugin (`install-plugin.yml`)
6. Generate delta package (`generate-delta.yml`)
7. Generate dynamic test command via `GenerateSfdxCommand.js`
8. Authenticate to Salesforce (`sf-login.yml`)
9. Validate deployment with targeted tests (`sf-check-deploy.yml`)
10. Run all Apex tests (`sf-check-deploy.yml` with `runAllTests: true`)

#### Stage 2 — Deployment (`DeployToSalesforce`)

Runs only after `BuildAndValidate` succeeds and uses the org's production variable group (which may require an approval gate in Azure DevOps).

1. Checkout, install CLI & plugin
2. Regenerate delta package
3. Authenticate to Salesforce
4. Deploy validated metadata (`sf-deploy.yml`)

---

### 2. **variables-pipelines.yml**

Manually triggered helper pipeline that publishes environment-specific secrets as a pipeline artifact (`myVar.txt`).

#### Parameters

* `group`: The Azure DevOps variable group to publish. One of: `SalesforceVariables`, `sfdev`, `sftest`, `sfuat`, `sfprod`.

#### How It Works

* Reads secret variables (`SF_USERNAME`, `SF_PASSWORD`, etc.) from the selected variable group
* Writes them as a JSON file and publishes it as the `MyArtifact` pipeline artifact

---

### 3. **azure-pipelines-without-destructive-package.yml**

A variant of the deployment pipeline that skips destructive changes. Triggered on `develop`, `test`, `uat`, and `main`. Uses the `*-without-destructive-package` template variants throughout.

---

## Reusable Templates

| Template | Purpose |
|---|---|
| `install-sf-cli.yml` | Installs the Salesforce CLI |
| `install-plugin.yml` | Installs `sfdx-git-delta` |
| `get-commit-hash.yml` | Resolves the target commit hash |
| `get-last-successful-commit.yml` | Retrieves the last successful pipeline commit |
| `generate-delta.yml` | Generates the delta package between commits |
| `sf-login.yml` | Authenticates to a Salesforce org |
| `sf-check-deploy.yml` | Validates a deployment (dry-run) with optional test execution |
| `sf-deploy.yml` | Deploys validated metadata to the target org |

`*-without-destructive-package` variants of `generate-delta`, `sf-check-deploy`, and `sf-deploy` are also available for pipelines that should not process destructive changes.

---

## Custom Script: `GenerateSfdxCommand.js`

This Node.js script reads the generated `package.xml` and:

* Searches for related test files in the project
* Generates a dynamic SFDX command to run only the relevant Apex tests

The output is stored as the pipeline variable `sfCommandTests`.

---

## Required Variable Groups

Each Salesforce environment must have a variable group in Azure DevOps containing:

| Variable | Description |
|---|---|
| `SF_CLIENT_ID` | Connected App client ID |
| `SF_CLIENT_SECRET` | Connected App client secret |
| `SF_USERNAME` | Salesforce username |
| `SF_PASSWORD` | Salesforce password |
| `SF_LOGIN_URL` | Salesforce login URL |

Variable groups used by this project:

* `sfdev`
* `sfqa`
* `sfuat`
* `sfpstage`
* `sfprod`
* `sfprod-validation` *(read-only group used during the validation stage for prod)*

---

## How to Use

### Deploy to a Salesforce Org

1. Push or merge your changes to the appropriate branch (`develop`, `qa`, `uat`, `stage`, or `main`).
2. The matching per-org pipeline will automatically:
   * Resolve the target commit
   * Generate the metadata delta
   * Determine which Apex test classes to run
   * Validate the deployment
   * Deploy to the target org (with optional approval gate for prod)

### Run with a Specific Commit

Trigger the pipeline manually and supply a value for the `CommitHash` parameter to target a specific commit range.

---

## Output

* Deployment delta in `./delta`
* Dynamic test command as pipeline variable: `sfCommandTests`
* Deployed changes applied to the target Salesforce org

---

## Notes

* Deployment uses `sf project deploy` (SOAP API explicitly enabled)
* Delta generation uses the `sfdx-git-delta` plugin
* The prod pipeline uses a separate `sfprod-validation` variable group during validation to allow an approval gate before the actual deployment variable group (`sfprod`) is used
