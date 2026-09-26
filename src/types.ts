export type DesignRecipe = "corporate" | "luxury" | "saas";
export type AnimationLevel = "none" | "subtle" | "expressive";
export type ProjectLanguage = "fr" | "en";
export type GenerationEngine = "native" | "openpage";
export type ProjectType = "landing" | "service" | "mobile" | "desktop" | "webapp" | "profile";
export type ServicePreset = "entitlements";
export type MobilePlatform = "android";
export type MobilePreset = "android-compose";
export type DesktopPlatform = "windows";
export type DesktopPreset = "tauri-react";
export type WebAppPreset = "react-vite";
export type Industry =
  | "legal"
  | "technology"
  | "finance"
  | "healthcare"
  | "education"
  | "logistics"
  | "real-estate"
  | "ecommerce"
  | "hospitality"
  | "creative"
  | "general";
export type BrandTone = "professional" | "premium" | "bold" | "friendly" | "minimal";
export type ConversionGoal = "leads" | "bookings" | "sales" | "signup" | "contact" | "awareness";
export type SectionKind =
  | "hero"
  | "trust"
  | "services"
  | "features"
  | "process"
  | "testimonials"
  | "pricing"
  | "faq"
  | "contact"
  | "final-cta";

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
  GITHUB_SERVICE_BLUEPRINT_OWNER?: string;
  GITHUB_SERVICE_BLUEPRINT_REPO?: string;
  GITHUB_SERVICE_BLUEPRINT_REF?: string;
  GITHUB_MOBILE_BLUEPRINT_OWNER?: string;
  GITHUB_MOBILE_BLUEPRINT_REPO?: string;
  GITHUB_MOBILE_BLUEPRINT_REF?: string;
  GITHUB_DESKTOP_BLUEPRINT_OWNER?: string;
  GITHUB_DESKTOP_BLUEPRINT_REPO?: string;
  GITHUB_DESKTOP_BLUEPRINT_REF?: string;
  GITHUB_WEBAPP_BLUEPRINT_OWNER?: string;
  GITHUB_WEBAPP_BLUEPRINT_REPO?: string;
  GITHUB_WEBAPP_BLUEPRINT_REF?: string;
  GITHUB_OIDC_AUDIENCE?: string;
  GITHUB_OIDC_REPOSITORY?: string;
  GITHUB_OIDC_REF?: string;
  GITHUB_OIDC_WORKFLOW_REF?: string;
  GITHUB_OIDC_PROVISIONER_REPOSITORY?: string;
  GITHUB_OIDC_PROVISIONER_WORKFLOW_REF?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_BUILD_TOKEN_UUID?: string;
  CLOUDFLARE_BUILD_TOKEN_SOURCE_WORKER?: string;
  OPENPAGE_GENERATOR_URL?: string;
  OPENPAGE_EXPORT_URL?: string;
  OPENPAGE_API_TOKEN?: string;
  ENVIRONMENT?: string;
}

export interface CreateProjectRequest {
  name: string;
  projectType?: ProjectType;
  preset?: ServicePreset | MobilePreset | DesktopPreset | WebAppPreset;
  platform?: MobilePlatform | DesktopPlatform;
  slug?: string;
  description?: string;
  private?: boolean;
  brief?: string;
  language?: ProjectLanguage;
  audience?: string;
  goal?: ConversionGoal;
  engine?: GenerationEngine;
  recipe?: DesignRecipe;
  animation?: AnimationLevel;
  heroTitle?: string;
  heroSubtitle?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
}

export interface ProjectSpecification {
  brief: string;
  language: ProjectLanguage;
  audience?: string;
  industry: Industry;
  tone: BrandTone;
  goal: ConversionGoal;
  design: {
    recipe: DesignRecipe;
    animation: AnimationLevel;
    palette: "navy-mint" | "midnight-gold" | "electric-indigo";
    typography: "grotesk" | "editorial" | "geometric";
    density: "airy" | "balanced";
  };
  sections: SectionKind[];
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
