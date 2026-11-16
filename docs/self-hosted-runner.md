# Reusable self-hosted GitHub Actions runner

Status: supported AppFactory infrastructure recipe  
Script: `scripts/vps/github-runner.sh`  
Related: Trigenys/appfactory#190 (Trigenys Auth provisioning)

## Purpose

Give several repositories of one GitHub owner a single, bounded runner on a Linux host, without
installing one runner per repository and without granting the runner any privilege on the host.

The recipe is a `plan → apply` reconciliation: `plan` prints the diff between the host and the
desired state and writes nothing; `apply` performs only the missing steps; a second `apply` on a
converged host is a no-op. `remove` decommissions a runner (unregister, unit, drop-in, directory).

## Desired state

| Item | Value |
| :-- | :-- |
| Service account | `ghrunner`: system account, `nologin`, no sudo, not in `docker` |
| Install directory | `/opt/actions-runner-<name>`, owned by the service account |
| Registration | organisation scope by default (`RUNNER_SCOPE=org`), repository scope on request |
| Labels | `self-hosted`, `Linux`, `X64` (implicit) plus `RUNNER_LABELS` |
| systemd unit | `actions.runner.<owner>[-<repo>].<name>.service`, `KillMode=mixed`, `Restart=on-failure` |
| Limits | drop-in `limits.conf`: `MemoryMax` (default 1G) and `CPUQuota` (default 150%) |
| Workspace hygiene | `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` purges `_work/<repo>` after every job (`PURGE_WORK=1`) |
| Release | latest `actions/runner` release unless `RUNNER_VERSION` pins one; tarball checksum verified |

The recipe never re-points an existing installation to another owner or repository: `plan`
reports the conflict (`!`) and `apply` refuses. Decommission with `remove`, then install.

## Scope choice

Repository-scoped runners (one per repository) are what Trigenys used first: `vps-registry`
(EagleFox31/project-registry) and `vps-seo` (Trigenys/trigenys-seo-monitor). Each idle listener
costs about 150 MB of RAM and a separate installation.

Organisation-scoped runners are preferred when several repositories of the same owner need a
runner: one installation, one memory budget, one place to upgrade. On the GitHub Free plan an
organisation has a single runner group (`Default`) visible to every repository of the
organisation, so an organisation runner is only acceptable when every repository of that
organisation is trusted. Jobs that handle production secrets stay on GitHub-hosted runners.

A runner cannot be shared across owners: an `EagleFox31` repository cannot use a `Trigenys`
organisation runner.

## Workflow side

Keep the runner choice in configuration, not in the workflow. The pattern already used by
`trigenys-seo-monitor`:

```yaml
runs-on: ${{ fromJSON(vars.SEO_RUNS_ON || '"ubuntu-latest"') }}
```

with the repository variable `SEO_RUNS_ON=["self-hosted","linux","seo"]`. A repository that has no
such variable falls back to GitHub-hosted runners, which is what freshly provisioned AppFactory
repositories do until a runner label is assigned to them.

## Operating procedure

Run on the host, from a sudoer account. The registration token comes from the operator's machine
and is short-lived (one hour); it is passed through the environment and never written to disk or logs.

```bash
# operator machine
TOKEN=$(gh api -X POST orgs/Trigenys/actions/runners/registration-token --jq .token)

# host
RUNNER_OWNER=Trigenys RUNNER_NAME=vps-trigenys RUNNER_LABELS=trigenys-vps,seo MEMORY_MAX=1500M \
  scripts/vps/github-runner.sh plan
RUNNER_TOKEN="$TOKEN" RUNNER_OWNER=Trigenys RUNNER_NAME=vps-trigenys RUNNER_LABELS=trigenys-vps,seo MEMORY_MAX=1500M \
  scripts/vps/github-runner.sh apply
```

Before `apply` on a shared host, check `free -m`: the new `MemoryMax` must fit in the memory left
by the other services, swap excluded.

Decommission (`remove`) needs a removal token:
`gh api -X POST repos/<owner>/<repo>/actions/runners/remove-token --jq .token`.

## Lessons recorded

- `KillMode=process` (the default from `svc.sh`) lets `Runner.Listener` survive a `systemctl stop`:
  the unit reports `inactive` while the runner still shows `online` on GitHub. The recipe uses
  `KillMode=mixed` so that stopping the unit stops the listener.
- `Runner.Listener --version` writes a `_diag` log, so probing the installed version must run as the
  runner account; running it as another user aborts with an access error.
