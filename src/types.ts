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
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  size?: number;
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
