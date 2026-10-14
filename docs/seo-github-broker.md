# SEO GitHub broker

`SeoGitHubBroker` is an internal named Worker RPC entrypoint. SEO Monitor binds to `appfactory-api` with this entrypoint and invokes `seoInstallationToken()`.

The broker reuses AppFactory's configured GitHub App identity and issues a short-lived installation token restricted to `trigenys-seo-monitor`, Actions write and Contents read. Callers cannot select a repository or permissions. There is no new public HTTP endpoint, no secret extraction, and no need to copy the private key to SEO Monitor.

Existing default HTTP routes are unchanged. During bootstrap, the exact deployed module was retained and the named export appended, with a deployment-head check to avoid replacing concurrent changes. This source export makes subsequent regular builds preserve the capability.
