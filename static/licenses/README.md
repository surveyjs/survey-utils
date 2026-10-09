# Licenses

Master copies of the SurveyJS license texts:

- `EULA` — commercial products
- `MIT` — open-source libraries and demos

A push to `main` that changes `EULA` or `MIT` runs the [Sync licenses](../../.github/workflows/sync-licenses.yml) workflow. It copies the changed file to every repo and path listed for it in [`targets.json`](targets.json) and commits directly to each repo's default branch. A change to `targets.json` syncs both licenses.

To add a target, add the repo (under the `surveyjs` organization) and the file paths inside it to `targets.json`. The files must already exist in the target repo.

The workflow can also be run manually from the Actions tab; manual runs are dry by default and only print the diff.

The workflow needs the `LICENSE_SYNC_TOKEN` secret: a token with Contents read/write access to every target repo.
