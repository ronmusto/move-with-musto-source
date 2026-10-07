# MLS ingestion architecture source

This folder contains the processing pipeline, serverless handlers, infrastructure template and their local tests. It is retained to make upload validation, processing state, coordinate/cache provenance, approval, immutable publication and request-boundary decisions reviewable.

The public source edition excludes account bootstrap, operator PowerShell wrappers, production access policies and private runbooks. The checked-in portal configuration is empty. No deploy command is provided. The template and buildspec are architecture source, not instructions to create resources in an account.

From the repository root:

```sh
npm run deps:infra
npm run test:infra
npm run check:infra
```

Tests use local fixtures and mocked adapters. The scaffold validator parses the template and verifies portable security/pipeline invariants; it does not contact AWS. Tests of excluded private wrappers are replaced by public-boundary tests. Do not run operational entrypoints against real MLS, mapping, email or cloud services as part of local evaluation.

See the root README and `docs/ARCHITECTURE.md` for the complete public-package scope.
