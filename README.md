# Azure DevOps Salesforce Deployment Pipeline

This repository provides a set of Azure DevOps pipelines to manage Salesforce metadata deployments through delta generation, environment-specific configurations, and test execution automation.

![Salesforce CICD Pipeline drawio](https://github.com/user-attachments/assets/f3aff19c-0f49-43ac-a629-86bf112afeb3)

## Overview

This pipeline architecture allows you to:

* Perform selective deployments to Salesforce using delta detection.
* Dynamically generate test class execution commands.
* Retrieve environment-specific secrets via dedicated pipelines.
* Automate comparison between different Salesforce environments.

---

## Pipeline Breakdown

### 1. **azure-pipelines.yml**

This is the main deployment pipeline triggered on:

* `develop`, `test`, `uat`, `main`

#### Key Steps:

* Install Node.js and Salesforce CLI
* Detect changed metadata between commits using `sfdx-git-delta`
* Retrieve last successful commit if none specified
* Use `GenerateSfdxCommand.js` to identify and run related test classes
* Authenticate to Salesforce using environment variables
* Perform a dry-run deployment
* Run local tests (optionally all)
* Deploy validated metadata to target org

---

### 2. **comparer-pipelines.yml**

Used to compare metadata between two environments (source and target).

#### Features:

* Retrieves metadata from both environments using Salesforce CLI
* Stores metadata into Git branches
* Generates delta package between environments
* Runs test or deployment based on delta (optional)

#### Parameters:

* `SourceSystemParam` & `TargetSystemParam`: Choose between dev, test, uat, prod.
* `DeployDelta`: Set to `true` to deploy the delta to the target org.

---

### 3. **variables-pipelines.yml**

Responsible for encoding and publishing environment-specific variables as artifacts.

#### How It Works:

* Extracts secret variables (e.g., `SF_USERNAME`, `SF_PASSWORD`, etc.)
* Publishes them as a file artifact (`myVar.txt`) to be consumed by other pipelines

---

## Custom Script: `GenerateSfdxCommand.js`

This Node.js script reads the generated `package.xml` and:

* Searches for related test files in the project
* Generates a dynamic SFDX command to run only the relevant Apex tests

---

## Required Variable Groups

Each Salesforce environment must have a variable group in Azure DevOps with the following:

* `SF_CLIENT_ID`
* `SF_CLIENT_SECRET`
* `SF_USERNAME`
* `SF_PASSWORD`
* `SF_LOGIN_URL`

These groups are:

* `sfdev`
* `sftest`
* `sfuat`
* `sfprod`
* `sfprod-predeployment`

---

## How to Use

### Deploy to Salesforce

1. Commit your changes to any of the tracked branches.
2. The pipeline will automatically run:

   * Retrieve last commit (if needed)
   * Generate delta
   * Determine test classes
   * Validate and deploy metadata

### Compare Environments

1. Run `comparer-pipelines.yml` manually.
2. Specify source and target systems.
3. Review delta and deploy if desired.

---

## Output

* Deployment delta in `./delta`
* Dynamic test command as pipeline variable: `sfCommandTests`
* Deployed changes applied to your Salesforce target org

---

## Notes

* Deployment is done using `sf project deploy` (SOAP API is explicitly enabled)
* Delta generation uses `sfdx-git-delta` plugin
* Platform variables are dynamically retrieved using the helper pipeline

