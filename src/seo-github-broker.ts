/// <reference types="@cloudflare/workers-types" />
import { WorkerEntrypoint } from "cloudflare:workers";
import { createGitHubAppJwt } from "./github";
import type { Env } from "./types";

/** Internal RPC only. Repository and permission choices are fixed by this broker. */
export class SeoGitHubBroker extends WorkerEntrypoint<Env> {
  async seoInstallationToken(): Promise<string> {
    const jwt = await createGitHubAppJwt(this.env);
    const scopes = [
      { actions: "write", contents: "read" },
      { actions: "read", contents: "write" }
    ];
    for (let index = 0; index < scopes.length; index++) {
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
          body: JSON.stringify({repositories:["trigenys-seo-monitor"],permissions:scopes[index]}),
          redirect: "manual",
          signal: AbortSignal.timeout(15000)
        }
      );
      if (response.status === 422 && index === 0) continue;
      if (!response.ok) {
        const details = await response.json() as {message?: string};
        throw new Error(`SEO_INSTALLATION_TOKEN_HTTP_${response.status}: ${details.message || "Unavailable"}`);
      }
      const data = await response.json() as {token:string};
      return data.token;
    }
    throw new Error("SEO_INSTALLATION_TOKEN_UNAVAILABLE");
  }
}
