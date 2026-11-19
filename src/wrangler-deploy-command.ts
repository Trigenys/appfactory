// Pure builders for the Workers Builds deploy command. No runtime imports so the
// generated shell can be executed against a fixture in tests.

export const HYPERDRIVE_JSONC_PLACEHOLDER = "appfactory-managed-hyperdrive";

const TOML_CONFIG = "wrangler.production.toml";
const JSONC_CONFIG = "wrangler.production.jsonc";

export type DeployCommandResult =
  | { ok: true; command: string }
  | { ok: false; code: string; message: string };

export interface HyperdriveBindingIdentity {
  binding: string;
  id: string;
}

function isSafeIdentity(identity: HyperdriveBindingIdentity): boolean {
  return (
    identity.binding === "HYPERDRIVE" &&
    /^[A-Za-z0-9-]+$/.test(identity.id) &&
    identity.id !== HYPERDRIVE_JSONC_PLACEHOLDER
  );
}

/**
 * Deploys from a temporary copy of the production Wrangler config carrying the
 * managed Hyperdrive id. The committed config is never modified.
 * - TOML: the binding block is appended.
 * - JSONC: the committed config declares the binding with the placeholder id
 *   `appfactory-managed-hyperdrive`; it must appear exactly once (fail closed).
 */
export function injectHyperdriveBinding(
  baseDeployCommand: string,
  identity: HyperdriveBindingIdentity
): DeployCommandResult {
  if (!isSafeIdentity(identity)) {
    return {
      ok: false,
      code: "HYPERDRIVE_DEPLOY_BINDING_INVALID",
      message: "Managed Hyperdrive marker is missing a safe HYPERDRIVE binding identity."
    };
  }

  const usesToml = baseDeployCommand.includes(TOML_CONFIG);
  const usesJsonc = baseDeployCommand.includes(JSONC_CONFIG);
  if (usesToml === usesJsonc) {
    return {
      ok: false,
      code: "HYPERDRIVE_DEPLOY_RECIPE_UNSUPPORTED",
      message: "Managed Hyperdrive binding requires the reviewed Wrangler production config recipe."
    };
  }

  const config = usesToml ? TOML_CONFIG : JSONC_CONFIG;
  const rewrittenDeployCommand = baseDeployCommand.replace(
    config,
    '"$APPFACTORY_WRANGLER_CONFIG"'
  );

  if (usesToml) {
    const bindingToml = `\\n[[hyperdrive]]\\nbinding = "${identity.binding}"\\nid = "${identity.id}"\\n`;
    return {
      ok: true,
      command: [
        'APPFACTORY_WRANGLER_CONFIG="$(mktemp .appfactory-wrangler.XXXXXX.toml)"',
        `cp ${TOML_CONFIG} "$APPFACTORY_WRANGLER_CONFIG"`,
        `printf '%b' '${bindingToml}' >> "$APPFACTORY_WRANGLER_CONFIG"`,
        `( trap 'rm -f "$APPFACTORY_WRANGLER_CONFIG"' EXIT; ${rewrittenDeployCommand} )`
      ].join(" && ")
    };
  }

  const placeholder = `"${HYPERDRIVE_JSONC_PLACEHOLDER}"`;
  return {
    ok: true,
    command:
      "( " +
      [
        'APPFACTORY_WRANGLER_CONFIG="$(mktemp .appfactory-wrangler.XXXXXX.jsonc)"',
        `trap 'rm -f "$APPFACTORY_WRANGLER_CONFIG"' EXIT`,
        `{ [ "$(grep -o '${placeholder}' ${JSONC_CONFIG} | wc -l)" -eq 1 ] || { echo "AppFactory: ${JSONC_CONFIG} must declare the HYPERDRIVE binding id ${placeholder} exactly once." >&2; exit 1; }; }`,
        `sed 's/${placeholder}/"${identity.id}"/' ${JSONC_CONFIG} > "$APPFACTORY_WRANGLER_CONFIG"`,
        rewrittenDeployCommand
      ].join(" && ") +
      " )"
  };
}
