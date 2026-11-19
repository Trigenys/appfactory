#!/usr/bin/env bash
# Reusable, idempotent GitHub Actions self-hosted runner recipe for a Linux host.
#
# Usage (run on the target host, as a sudoer):
#   RUNNER_OWNER=Trigenys RUNNER_NAME=vps-trigenys RUNNER_LABELS=trigenys-vps,seo \
#     scripts/vps/github-runner.sh plan
#   RUNNER_TOKEN=<registration token> ... scripts/vps/github-runner.sh apply
#   RUNNER_TOKEN=<removal token>      ... scripts/vps/github-runner.sh remove
#
# Configuration (environment, optional unless stated):
#   RUNNER_SCOPE     org | repo                       (default: org)
#   RUNNER_OWNER     GitHub organisation or user      (required)
#   RUNNER_REPO      repository name, scope=repo only
#   RUNNER_NAME      runner name, also the install suffix (required)
#   RUNNER_LABELS    comma separated extra labels      (default: none)
#   RUNNER_VERSION   runner release, e.g. 2.338.2      (default: latest from api.github.com)
#   RUNNER_USER      unprivileged service account      (default: ghrunner)
#   RUNNER_DIR       install directory                 (default: /opt/actions-runner-<name>)
#   MEMORY_MAX       systemd MemoryMax                 (default: 1G)
#   CPU_QUOTA        systemd CPUQuota                  (default: 150%)
#   PURGE_WORK       1 = purge _work after each job    (default: 1)
#   RUNNER_TOKEN     registration (apply) or removal (remove) token; never logged
#
# plan   : prints the reconciliation diff, writes nothing, exit 0.
# apply  : performs only the missing steps; a converged host is a no-op.
# remove : unregisters the runner and deletes service, drop-in and directory.
set -euo pipefail

ACTION="${1:-plan}"
RUNNER_SCOPE="${RUNNER_SCOPE:-org}"
RUNNER_OWNER="${RUNNER_OWNER:?RUNNER_OWNER is required}"
RUNNER_REPO="${RUNNER_REPO:-}"
RUNNER_NAME="${RUNNER_NAME:?RUNNER_NAME is required}"
RUNNER_LABELS="${RUNNER_LABELS:-}"
RUNNER_USER="${RUNNER_USER:-ghrunner}"
RUNNER_DIR="${RUNNER_DIR:-/opt/actions-runner-${RUNNER_NAME}}"
MEMORY_MAX="${MEMORY_MAX:-1G}"
CPU_QUOTA="${CPU_QUOTA:-150%}"
PURGE_WORK="${PURGE_WORK:-1}"

case "$RUNNER_SCOPE" in
  org)
    GITHUB_URL="https://github.com/${RUNNER_OWNER}"
    UNIT_ID="${RUNNER_OWNER}"
    ;;
  repo)
    if [ -z "$RUNNER_REPO" ]; then
      echo "RUNNER_REPO is required when RUNNER_SCOPE=repo" >&2
      exit 2
    fi
    GITHUB_URL="https://github.com/${RUNNER_OWNER}/${RUNNER_REPO}"
    UNIT_ID="${RUNNER_OWNER}-${RUNNER_REPO}"
    ;;
  *)
    echo "RUNNER_SCOPE must be org or repo" >&2
    exit 2
    ;;
esac

SERVICE="actions.runner.${UNIT_ID}.${RUNNER_NAME}.service"
UNIT_FILE="/etc/systemd/system/${SERVICE}"
DROPIN_DIR="/etc/systemd/system/${SERVICE}.d"
DROPIN_FILE="${DROPIN_DIR}/limits.conf"
HOOK_FILE="${RUNNER_DIR}/hooks/purge-work.sh"
ENV_LINE="ACTIONS_RUNNER_HOOK_JOB_COMPLETED=${HOOK_FILE}"

case "$(uname -m)" in
  x86_64) RUNNER_ARCH=x64 ;;
  aarch64) RUNNER_ARCH=arm64 ;;
  *)
    echo "unsupported architecture: $(uname -m)" >&2
    exit 2
    ;;
esac

resolve_version() {
  if [ -n "${RUNNER_VERSION:-}" ]; then
    echo "${RUNNER_VERSION#v}"
    return
  fi
  curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
    | grep -o '"tag_name": *"v[0-9.]*"' | grep -o '[0-9][0-9.]*'
}

installed_version() {
  local listener="${RUNNER_DIR}/bin/Runner.Listener"
  if [ ! -x "$listener" ]; then
    echo none
    return
  fi
  # Runner.Listener writes a _diag log, so it must run as the runner account.
  (cd "${RUNNER_DIR}" && sudo -u "${RUNNER_USER}" ./bin/Runner.Listener --version 2>/dev/null | head -1) || echo unknown
}

runner_field() {
  local file="${RUNNER_DIR}/.runner"
  if [ ! -f "$file" ]; then
    echo none
    return
  fi
  grep -o "\"$1\": *\"[^\"]*\"" "$file" | cut -d'"' -f4 || echo unknown
}

desired_unit() {
  cat <<UNIT
[Unit]
Description=GitHub Actions Runner (${UNIT_ID}.${RUNNER_NAME})
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${RUNNER_DIR}/runsvc.sh
User=${RUNNER_USER}
WorkingDirectory=${RUNNER_DIR}
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=5min
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
}

desired_dropin() {
  cat <<DROPIN
[Service]
MemoryMax=${MEMORY_MAX}
CPUQuota=${CPU_QUOTA}
DROPIN
}

desired_hook() {
  cat <<'HOOK'
#!/usr/bin/env bash
# ACTIONS_RUNNER_HOOK_JOB_COMPLETED: purge checked-out repositories so the next
# job, possibly from another repository, starts from a clean workspace.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/_work"
[ -d "$root" ] || exit 0
find "$root" -mindepth 1 -maxdepth 1 -type d ! -name '_*' -exec rm -rf {} +
HOOK
}

file_or_none() {
  if [ -f "$1" ]; then cat "$1"; else echo none; fi
}

DIFF=()
note() {
  DIFF+=("$1")
  echo "$1"
}

# ---- inspect current state --------------------------------------------------
WANT_VERSION="$(resolve_version)"
HAVE_VERSION="$(installed_version)"
HAVE_URL="$(runner_field gitHubUrl)"
HAVE_NAME="$(runner_field agentName)"
HAVE_UNIT="$(file_or_none "$UNIT_FILE")"
HAVE_DROPIN="$(file_or_none "$DROPIN_FILE")"
HAVE_HOOK="$(file_or_none "$HOOK_FILE")"
HAVE_ENV=""
if [ -f "${RUNNER_DIR}/.env" ] && grep -qF "$ENV_LINE" "${RUNNER_DIR}/.env"; then HAVE_ENV=yes; fi
ENABLED="$(systemctl is-enabled "$SERVICE" 2>/dev/null || echo disabled)"
ACTIVE="$(systemctl is-active "$SERVICE" 2>/dev/null || echo inactive)"

echo "runner ${RUNNER_NAME} -> ${GITHUB_URL} (${RUNNER_DIR})"
if id "$RUNNER_USER" >/dev/null 2>&1; then echo "= user ${RUNNER_USER}"; else note "+ user ${RUNNER_USER} (system account, nologin, no sudo, no docker)"; fi
if [ "$HAVE_VERSION" = "$WANT_VERSION" ]; then echo "= runner ${WANT_VERSION}"; else note "~ runner ${HAVE_VERSION} -> ${WANT_VERSION}"; fi
if [ "$HAVE_URL" = "$GITHUB_URL" ] && [ "$HAVE_NAME" = "$RUNNER_NAME" ]; then
  echo "= registered as ${RUNNER_NAME} on ${GITHUB_URL}"
elif [ "$HAVE_URL" = none ]; then
  note "+ register on ${GITHUB_URL} labels=[${RUNNER_LABELS}] (needs RUNNER_TOKEN)"
else
  note "! registered on ${HAVE_URL} as ${HAVE_NAME}: run 'remove' first, this recipe never re-points a runner"
fi
if [ "$PURGE_WORK" = 1 ]; then
  if [ "$HAVE_HOOK" = "$(desired_hook)" ]; then echo "= job-completed purge hook"; else note "~ job-completed purge hook"; fi
  if [ -n "$HAVE_ENV" ]; then echo "= .env hook wiring"; else note "~ .env hook wiring"; fi
fi
if [ "$HAVE_UNIT" = "$(desired_unit)" ]; then echo "= ${SERVICE}"; else note "~ ${SERVICE}"; fi
if [ "$HAVE_DROPIN" = "$(desired_dropin)" ]; then echo "= limits MemoryMax=${MEMORY_MAX} CPUQuota=${CPU_QUOTA}"; else note "~ limits MemoryMax=${MEMORY_MAX} CPUQuota=${CPU_QUOTA}"; fi
if [ "$ENABLED" = enabled ]; then echo "= enabled"; else note "~ enable"; fi
if [ "$ACTIVE" = active ]; then echo "= active"; else note "~ start"; fi

# ---- remove -----------------------------------------------------------------
if [ "$ACTION" = remove ]; then
  if [ ! -d "$RUNNER_DIR" ]; then
    echo "nothing to remove"
    exit 0
  fi
  sudo systemctl disable --now "$SERVICE" 2>/dev/null || true
  sudo pkill -u "$RUNNER_USER" -f "${RUNNER_DIR}/bin/Runner.Listener" 2>/dev/null || true
  # svc.sh leaves a .service marker that makes config.sh remove refuse; the unit is handled here.
  sudo rm -f "${RUNNER_DIR}/.service"
  if [ -f "${RUNNER_DIR}/.runner" ]; then
    : "${RUNNER_TOKEN:?RUNNER_TOKEN (removal token) is required to unregister}"
    (cd "$RUNNER_DIR" && sudo -u "$RUNNER_USER" ./config.sh remove --token "$RUNNER_TOKEN")
  fi
  sudo rm -rf "$UNIT_FILE" "$DROPIN_DIR" "$RUNNER_DIR"
  sudo systemctl daemon-reload
  echo "removed ${RUNNER_NAME}"
  exit 0
fi

# ---- plan -------------------------------------------------------------------
if [ "$ACTION" = plan ]; then
  if [ "${#DIFF[@]}" -eq 0 ]; then echo "converged: nothing to do"; else echo "${#DIFF[@]} change(s) pending"; fi
  exit 0
fi
if [ "$ACTION" != apply ]; then
  echo "unknown action: $ACTION (plan|apply|remove)" >&2
  exit 2
fi
if [ "${#DIFF[@]}" -eq 0 ]; then
  echo "converged: nothing to do"
  exit 0
fi
if printf '%s\n' "${DIFF[@]}" | grep -q '^!'; then
  echo "refusing to apply while a conflicting registration exists" >&2
  exit 1
fi

# ---- apply ------------------------------------------------------------------
if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  sudo useradd --system --create-home --home-dir "/home/${RUNNER_USER}" --shell /usr/sbin/nologin "$RUNNER_USER"
fi

if [ "$HAVE_VERSION" != "$WANT_VERSION" ]; then
  if [ "$ACTIVE" = active ]; then sudo systemctl stop "$SERVICE"; fi
  tmp="$(mktemp -d)"
  tarball="actions-runner-linux-${RUNNER_ARCH}-${WANT_VERSION}.tar.gz"
  base="https://github.com/actions/runner/releases/download/v${WANT_VERSION}"
  curl -fsSL -o "${tmp}/${tarball}" "${base}/${tarball}"
  if curl -fsSL -o "${tmp}/sha256" "${base}/${tarball}.sha256" 2>/dev/null && [ -s "${tmp}/sha256" ]; then
    (cd "$tmp" && echo "$(cut -d' ' -f1 sha256)  ${tarball}" | sha256sum -c -)
  fi
  sudo mkdir -p "$RUNNER_DIR"
  sudo tar -xzf "${tmp}/${tarball}" -C "$RUNNER_DIR"
  sudo chown -R "${RUNNER_USER}:${RUNNER_USER}" "$RUNNER_DIR"
  rm -rf "$tmp"
  if [ -x "${RUNNER_DIR}/bin/installdependencies.sh" ]; then sudo "${RUNNER_DIR}/bin/installdependencies.sh" >/dev/null; fi
fi

if [ "$HAVE_URL" = none ]; then
  : "${RUNNER_TOKEN:?RUNNER_TOKEN (registration token) is required to register}"
  label_args=()
  if [ -n "$RUNNER_LABELS" ]; then label_args=(--labels "$RUNNER_LABELS"); fi
  (cd "$RUNNER_DIR" && sudo -u "$RUNNER_USER" ./config.sh --unattended \
    --url "$GITHUB_URL" --token "$RUNNER_TOKEN" --name "$RUNNER_NAME" \
    "${label_args[@]}" --work _work --replace)
fi

if [ "$PURGE_WORK" = 1 ]; then
  sudo -u "$RUNNER_USER" mkdir -p "$(dirname "$HOOK_FILE")"
  desired_hook | sudo -u "$RUNNER_USER" tee "$HOOK_FILE" >/dev/null
  sudo chmod 755 "$HOOK_FILE"
  if [ -z "$HAVE_ENV" ]; then
    sudo -u "$RUNNER_USER" touch "${RUNNER_DIR}/.env"
    sudo -u "$RUNNER_USER" sed -i '/^ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/d' "${RUNNER_DIR}/.env"
    echo "$ENV_LINE" | sudo -u "$RUNNER_USER" tee -a "${RUNNER_DIR}/.env" >/dev/null
  fi
fi

if [ ! -x "${RUNNER_DIR}/runsvc.sh" ]; then
  sudo -u "$RUNNER_USER" cp "${RUNNER_DIR}/bin/runsvc.sh" "${RUNNER_DIR}/runsvc.sh"
  sudo chmod 755 "${RUNNER_DIR}/runsvc.sh"
fi

desired_unit | sudo tee "$UNIT_FILE" >/dev/null
sudo mkdir -p "$DROPIN_DIR"
desired_dropin | sudo tee "$DROPIN_FILE" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null
sudo systemctl restart "$SERVICE"
sleep 3
if systemctl is-active --quiet "$SERVICE"; then
  echo "applied: ${SERVICE} active"
else
  echo "service failed to start" >&2
  sudo journalctl -u "$SERVICE" -n 20 --no-pager
  exit 1
fi
