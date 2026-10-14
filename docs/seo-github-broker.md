# SEO GitHub broker

Internal named RPC entrypoint `SeoGitHubBroker` provides `seoInstallationToken()`. It reuses AppFactory's identity without exposing or copying its private key. The repository is fixed to `trigenys-seo-monitor`.

The broker first requests Actions write / Contents read. If GitHub definitively rejects that permission set (422), it requests Actions read / Contents write, then Contents write alone. The API can use repository dispatch when workflow dispatch is forbidden. No network, authentication or other error causes a wider retry. Callers cannot supply repositories or scopes.

Database leases for repository dispatch are restricted to the existing `seo-monitor.yml` workflow on main, alongside its existing scheduled/manual events. Default AppFactory HTTP routes are unchanged.
