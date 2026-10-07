# Security

Report a suspected vulnerability privately to Renaldo Musto at renaldomusto@gmail.com before posting exploit details or sensitive records publicly. The source-edition repository is https://github.com/ronmusto/move-with-musto-source. If private vulnerability reporting is enabled there, you may also use its Security tab. No response-time commitment is implied.

Include the affected file or component, a minimal reproduction using synthetic data, expected behavior, observed behavior, and relevant runtime versions. Never include credentials, subscriber data, real MLS records, private documents, or a working production access token in an issue or test fixture.

Local evaluation should use the documented loopback servers and synthetic tests. Do not probe the operated website, contact endpoints, MLS provider, mapping service, or AWS account as part of a source review. Install, build and standard tests require no live credentials. Optional operational algorithms in this repository should not be invoked against external services without explicit authorization from their owner.

The public package intentionally excludes production deployment automation and install hooks. Inquiry and unsubscribe endpoints are blank by default; map credentials and operator-portal configuration are also empty. Keep secrets out of all `NEXT_PUBLIC_` variables, which are embedded in browser code. Do not commit `.env` files or real listing exports.
