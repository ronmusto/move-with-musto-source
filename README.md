# Move With Musto — source edition

A real-estate web application built with TypeScript, React, Next.js and separate
AWS serverless services. This edition exposes the implementation for technical
and hiring review without publishing licensed listing data, private client
documents, original restricted imagery or Git history.

Start with the [reviewer walkthrough](docs/CODE-REVIEW-GUIDE.md) and
[architecture guide](docs/ARCHITECTURE.md). The frontend covers property search,
filters, history, comparison, saved homes, maps and inquiry flows. Serverless
source covers validation, operator-controlled processing, immutable publication
generations and contact handling.

## License

Copyright (c) 2026 Renaldo Musto. This project is **source available for
evaluation**, under the [Move With Musto Source Evaluation License](LICENSE).
You may inspect, build, test and privately experiment with it for evaluation,
including hiring review. General reuse, commercial operation, public deployment
and redistribution require separate written permission, except for rights
independently granted by law, third-party licenses or applicable hosting terms.
See [NOTICE](NOTICE.md) for third-party rights and asset provenance.

## Run locally

Use Node.js 22.13 or newer within Node 22, and npm 10 or newer. No cloud
credentials or environment file are needed for the default local experience.

```sh
npm ci --ignore-scripts
npm run dev
```

Open http://127.0.0.1:3019. For a static export:

```sh
npm run build
npm start
```

Both servers bind to loopback. The source edition runs the full application;
its configuration is independent of the separately operated website.

## What is included

- Application and processing source, with invented automated-test records.
- Labeled geometric replacement images that preserve layout dimensions.
  They contain no pixels from the original photography or logos.
- Inter and Playfair Display fonts with their unchanged SIL OFL licenses.
- Municipality maps with [MassGIS attribution](docs/MASSGIS-NOTICE.txt).

The default local site has no live listing inventory and shows its unavailable
state. The browser-test harness supplies invented listings in memory to test
interactive flows. Those fixtures are not published as properties in the app.

Inquiry and unsubscribe endpoints, Maps credentials, and the operator portal's
cloud configuration are blank. The standard local checks do not call paid
Maps APIs, access AWS, ingest licensed data or send forms. Ordinary public
business links remain telephone, email and website links.

## Validate

```sh
npm run check:public
npm run lint
npm test
npm run deps:infra
npm run test:infra
npm run check:infra
npm run test:preview
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:e2e:extended
```

`test:e2e` builds with external integrations disabled and opens its own
isolated Chromium context against a loopback server on port 4319. It exercises
the real UI with invented inventory. External requests and form submissions
are blocked and fail the suite. It does not attach to a personal browser.

The default browser command uses the marked smoke scenarios.
`test:e2e:extended` also covers responsive width sweeps, desktop and mobile
navigation, and text enlargement. Both commands exclude live-provider tests
and block external calls. Separate real-map cases require explicit opt-in and
owner-provided configuration; they are not evidence of verified live behavior.
Infrastructure tests use local service substitutes. Preview-server tests
cover request and path handling. The full build uses bundled fonts.

The GitHub verification workflow has read-only repository permissions, no
deployment credentials and no install hooks. It runs the local checks and
the extended isolated Chromium suite.

## Boundaries

This is a history-free source edition, not a cloud deployment kit. Production
deployment workflows, operator wrappers, private runbooks and Git hooks are
excluded. Some processing algorithms could contact external services if
deliberately configured and invoked; they are not part of installation,
local preview or the standard test commands.

`.env.example` describes optional integrations. `NEXT_PUBLIC_` values are
visible in a browser build and must never contain secrets. Neither source
availability nor the license grants access to MLS data or private services.

See [SECURITY](SECURITY.md), [font attribution](docs/font-attribution.md), and
the [replacement asset manifest](docs/placeholder-assets.json).
