import { WorkerEntrypoint } from "cloudflare:workers";
import { createGitHubAppJwt } from "./github";
import type { Env } from "./types";

/** Internal RPC only. Callers cannot choose a repository or token permissions. */
export class SeoGitHubBroker extends WorkerEntrypoint<Env> {
  async seoInstallationToken(): Promise<string> {
    const jwt = await createGitHubAppJwt(this.env);
    const response = await fetch(
      `https://api.github.com/app/installations/${this.env.GITHUB_INSTALLATION_ID}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "Trigenys-SEO-Monitor",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
          repositories: ["trigenys-seo-monitor"],
          permissions: { actions: "write", contents: "read" }
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(15000)
      }
    );
    if (!response.ok) throw new Error(`SEO_INSTALLATION_TOKEN_HTTP_${response.status}`);
    const data = await response.json() as { token: string };
    return data.token;
  }
}
