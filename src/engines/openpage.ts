import type { CreateProjectRequest, Env } from "../types";

const OPENPAGE_UPSTREAM = "buildingopen/openpage";
const DEFAULT_TIMEOUT_MS = 35_000;
const EXPORT_TIMEOUT_MS = 20_000;

const VALID_BLOCK_TYPES = new Set([
  "navbar",
  "hero",
  "features",
  "pricing",
  "cta",
  "footer",
  "testimonials",
  "stats",
  "faq",
  "team",
  "contact",
  "newsletter",
  "logocloud",
  "divider",
  "banner",
  "content",
  "image",
  "video",
  "gallery"
]);

const EVIDENCE_SENSITIVE_BLOCKS = new Set(["pricing", "testimonials", "stats", "logocloud"]);

export interface OpenPageBlockConfig {
  id: string;
  type: string;
  variant: string;
  props: Record<string, unknown>;
}

export interface OpenPageThemeConfig {
  bg0?: string;
  bg1?: string;
  bg2?: string;
  bg3?: string;
  bg4?: string;
  bg5?: string;
  text0?: string;
  text1?: string;
  text2?: string;
  text3?: string;
  accent?: string;
  accentDim?: string;
  borderDefault?: string;
  borderSubtle?: string;
  borderHover?: string;
  fontSans?: string;
  fontDisplay?: string;
  fontMono?: string;
  radius?: number;
  radiusLg?: number;
}

export interface OpenPageSiteConfig {
  name: string;
  blocks: OpenPageBlockConfig[];
  theme?: OpenPageThemeConfig;
  pages?: Array<{
    id: string;
    name: string;
    path: string;
    blocks: OpenPageBlockConfig[];
  }>;
}

export interface OpenPageGenerationResult {
  engine: "openpage";
  upstream: typeof OPENPAGE_UPSTREAM;
  endpoint: string;
  config: OpenPageSiteConfig;
  quality: {
    removedEvidenceSensitiveBlocks: string[];
  };
}

function normalizeEndpoint(value: string, fallbackPath: string): string {
  const configured = value.trim().replace(/\/+$/, "");
  if (!configured) throw new Error("OpenPage endpoint is empty.");

  try {
    const url = new URL(configured);
    const path = url.pathname.replace(/\/+$/, "");
    if (path && path !== "/") return configured;
    return `${configured}${fallbackPath}`;
  } catch {
    throw new Error(`Invalid OpenPage endpoint URL: ${configured}`);
  }
}

function generatorEndpointFromEnv(env: Env): string {
  if (!env.OPENPAGE_GENERATOR_URL?.trim()) {
    throw new Error(
      "OpenPage engine is not configured. Set OPENPAGE_GENERATOR_URL to the Trigenys OpenPage engine URL."
    );
  }
  return normalizeEndpoint(env.OPENPAGE_GENERATOR_URL, "/api/appfactory-generate");
}

function exportEndpointFromEnv(env: Env): string {
  if (!env.OPENPAGE_EXPORT_URL?.trim()) {
    throw new Error(
      "OpenPage export is not configured. Set OPENPAGE_EXPORT_URL to the Trigenys OpenPage export endpoint."
    );
  }
  return normalizeEndpoint(env.OPENPAGE_EXPORT_URL, "/api/appfactory-export");
}

function buildPrompt(input: CreateProjectRequest & { slug: string }): string {
  const lines = [
    `Create a production-quality landing page for ${input.name}.`,
    input.brief ? `Business brief: ${input.brief}` : undefined,
    input.audience ? `Target audience: ${input.audience}` : undefined,
    `Language: ${input.language || "en"}.`,
    input.goal ? `Primary conversion goal: ${input.goal}.` : undefined,
    "Keep the copy specific to the business and avoid describing the website-generation process.",
    "Do not mention OpenPage, AppFactory, AI, templates, manifests, or generation tooling in client-facing copy.",
    "Do not invent testimonials, customer logos, performance statistics, awards, certifications, prices, team members, addresses, phone numbers, emails, or factual claims that were not supplied in the brief.",
    "Prefer a strong hero, useful business-specific sections, a clear CTA, FAQ when useful, and a footer."
  ].filter(Boolean);

  return lines.join("\n");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function containsUnsafeUrl(value: unknown): boolean {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith("javascript:") || normalized.startsWith("data:text/html");
  }
  if (Array.isArray(value)) return value.some(containsUnsafeUrl);
  if (isObject(value)) return Object.values(value).some(containsUnsafeUrl);
  return false;
}

function sanitizeBlock(raw: unknown, index: number): OpenPageBlockConfig | null {
  if (!isObject(raw)) return null;
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!VALID_BLOCK_TYPES.has(type)) return null;

  const props = isObject(raw.props) ? raw.props : {};
  if (containsUnsafeUrl(props)) return null;

  return {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : `block-${type}-${index + 1}`,
    type,
    variant:
      typeof raw.variant === "string" && raw.variant.trim()
        ? raw.variant.trim()
        : "default",
    props
  };
}

function suppliedEvidence(input: CreateProjectRequest & { slug: string }): string {
  return `${input.brief || ""} ${input.description || ""}`.toLowerCase();
}

function mayKeepEvidenceSensitiveBlock(
  type: string,
  input: CreateProjectRequest & { slug: string }
): boolean {
  const evidence = suppliedEvidence(input);
  if (type === "pricing") {
    return /(?:price|pricing|prix|tarif|€|\$|fcfa|xaf|usd|eur)/i.test(evidence);
  }
  if (type === "testimonials") {
    return /(?:testimonial|témoignage|temoignage|avis client|client said|quote from)/i.test(evidence);
  }
  if (type === "stats") {
    return /(?:\b\d+(?:[.,]\d+)?%|\b\d+\+|clients?|users?|utilisateurs?|projects?|projets?)/i.test(evidence);
  }
  if (type === "logocloud") {
    return /(?:clients?|customers?|partenaires?|partners?|trusted by|ils nous font confiance)/i.test(evidence);
  }
  return true;
}

function sanitizeBlocks(
  rawBlocks: unknown[],
  input: CreateProjectRequest & { slug: string },
  removed: string[]
): OpenPageBlockConfig[] {
  const blocks: OpenPageBlockConfig[] = [];

  rawBlocks.forEach((raw, index) => {
    const block = sanitizeBlock(raw, index);
    if (!block) return;

    if (
      EVIDENCE_SENSITIVE_BLOCKS.has(block.type) &&
      !mayKeepEvidenceSensitiveBlock(block.type, input)
    ) {
      removed.push(block.type);
      return;
    }

    blocks.push(block);
  });

  return blocks;
}

function validateAndSanitizeSiteConfig(
  raw: unknown,
  input: CreateProjectRequest & { slug: string }
): { config: OpenPageSiteConfig; removed: string[] } {
  if (!isObject(raw)) {
    throw new Error("OpenPage returned an invalid site configuration.");
  }

  const removed: string[] = [];
  let blocks = Array.isArray(raw.blocks) ? sanitizeBlocks(raw.blocks, input, removed) : [];

  let pages: OpenPageSiteConfig["pages"];
  if (Array.isArray(raw.pages)) {
    pages = raw.pages
      .map((rawPage, pageIndex) => {
        if (!isObject(rawPage)) return null;
        const pageBlocks = Array.isArray(rawPage.blocks)
          ? sanitizeBlocks(rawPage.blocks, input, removed)
          : [];
        if (pageBlocks.length === 0) return null;

        return {
          id:
            typeof rawPage.id === "string" && rawPage.id.trim()
              ? rawPage.id.trim()
              : `page-${pageIndex + 1}`,
          name:
            typeof rawPage.name === "string" && rawPage.name.trim()
              ? rawPage.name.trim()
              : `Page ${pageIndex + 1}`,
          path:
            typeof rawPage.path === "string" && rawPage.path.trim()
              ? rawPage.path.trim()
              : pageIndex === 0
                ? "/"
                : `/page-${pageIndex + 1}`,
          blocks: pageBlocks
        };
      })
      .filter((page): page is NonNullable<typeof page> => Boolean(page));

    if (pages.length === 0) pages = undefined;
  }

  if (blocks.length === 0 && pages?.length) {
    blocks = pages[0].blocks;
  }

  if (blocks.length === 0) {
    throw new Error("OpenPage returned no usable blocks after AppFactory quality filtering.");
  }

  if (!blocks.some((block) => block.type === "hero")) {
    throw new Error("OpenPage output failed quality validation: a hero block is required.");
  }

  if (!blocks.some((block) => block.type === "cta" || block.type === "contact")) {
    throw new Error("OpenPage output failed quality validation: a CTA or contact block is required.");
  }

  const config: OpenPageSiteConfig = {
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : input.name,
    blocks
  };

  if (pages) config.pages = pages;
  if (isObject(raw.theme)) config.theme = raw.theme as OpenPageThemeConfig;

  return { config, removed: [...new Set(removed)] };
}

function authenticatedHeaders(env: Env): Headers {
  if (!env.OPENPAGE_API_TOKEN?.trim()) {
    throw new Error("OpenPage engine requires the OPENPAGE_API_TOKEN Worker secret.");
  }
  return new Headers({
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.OPENPAGE_API_TOKEN}`
  });
}

export function openPageConfigured(env: Env): boolean {
  return Boolean(
    env.OPENPAGE_GENERATOR_URL?.trim() &&
      env.OPENPAGE_EXPORT_URL?.trim() &&
      env.OPENPAGE_API_TOKEN?.trim()
  );
}

export async function generateWithOpenPage(
  env: Env,
  input: CreateProjectRequest & { slug: string }
): Promise<OpenPageGenerationResult> {
  const endpoint = generatorEndpointFromEnv(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: authenticatedHeaders(env),
      signal: controller.signal,
      body: JSON.stringify({ prompt: buildPrompt(input) })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `OpenPage generation failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}.`
      );
    }

    const raw = (await response.json()) as unknown;
    const { config, removed } = validateAndSanitizeSiteConfig(raw, input);

    return {
      engine: "openpage",
      upstream: OPENPAGE_UPSTREAM,
      endpoint,
      config,
      quality: {
        removedEvidenceSensitiveBlocks: removed
      }
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenPage generation timed out after ${DEFAULT_TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function exportWithOpenPage(
  env: Env,
  input: CreateProjectRequest & { slug: string },
  config: OpenPageSiteConfig
): Promise<string> {
  const endpoint = exportEndpointFromEnv(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: authenticatedHeaders(env),
      signal: controller.signal,
      body: JSON.stringify({
        config,
        settings: {
          siteName: input.name,
          siteDescription: input.description || input.brief || undefined,
          language: input.language || "en",
          seoTitle: input.name,
          seoDescription: input.brief || input.description || undefined
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `OpenPage export failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}.`
      );
    }

    const html = await response.text();
    if (!/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) {
      throw new Error("OpenPage export returned an invalid HTML document.");
    }
    return html;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenPage export timed out after ${EXPORT_TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
