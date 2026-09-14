export type DesignRecipe = "corporate" | "luxury" | "saas";
export type AnimationLevel = "none" | "subtle" | "expressive";

export interface Env {
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_PRIVATE_KEY?: string;
  GITHUB_PRIVATE_KEY_PKCS8?: string;
  GITHUB_OWNER?: string;
  GITHUB_TEMPLATE_OWNER?: string;
  GITHUB_TEMPLATE_REPO?: string;
  GITHUB_COMMIT_AUTHOR_NAME?: string;
  GITHUB_COMMIT_AUTHOR_EMAIL?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  ENVIRONMENT?: string;
}

export interface CreateProjectRequest {
  name: string;
  slug?: string;
  description?: string;
  private?: boolean;
  recipe?: DesignRecipe;
  animation?: AnimationLevel;
  heroTitle?: string;
  heroSubtitle?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
}

export interface GitHubRepository {
  id?: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  size?: number;
  owner?: {
    login: string;
    id: number;
  };
  template_repository?: {
    full_name: string;
  } | null;
}

export interface GitHubContentFile {
  sha: string;
}

export interface GitHubContentCommit {
  commit: {
    sha: string;
  };
}

export interface CloudflarePagesProject {
  id: string;
  name: string;
  subdomain?: string;
  production_branch: string;
  source?: {
    type: "github" | "gitlab";
    config: {
      owner?: string;
      owner_id?: string;
      repo_id?: string;
      repo_name?: string;
      production_branch?: string;
      production_deployments_enabled?: boolean;
      preview_deployment_setting?: "all" | "none" | "custom";
    };
  };
}

export interface CloudflarePagesDeployment {
  id: string;
  url?: string;
  environment?: "production" | "preview";
  is_skipped?: boolean;
  latest_stage?: {
    name: "queued" | "initialize" | "clone_repo" | "build" | "deploy";
    status: "success" | "idle" | "active" | "failure" | "canceled";
  };
  deployment_trigger?: {
    type: "github:push" | "ad_hoc" | "deploy_hook";
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
}

export interface CloudflareApiResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
}
