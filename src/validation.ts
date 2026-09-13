import type { AnimationLevel, CreateProjectRequest, DesignRecipe } from "./types";

const RECIPES = new Set<DesignRecipe>(["corporate", "luxury", "saas"]);
const ANIMATIONS = new Set<AnimationLevel>(["none", "subtle", "expressive"]);

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

export function validateCreateProject(input: unknown): CreateProjectRequest & { slug: string } {
  if (!input || typeof input !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const body = input as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name || name.length > 100) {
    throw new Error("name is required and must be at most 100 characters.");
  }

  const requestedSlug = typeof body.slug === "string" ? body.slug.trim() : "";
  const slug = slugify(requestedSlug || name);

  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("A valid repository slug could not be produced.");
  }

  const recipe = body.recipe ?? "corporate";
  if (typeof recipe !== "string" || !RECIPES.has(recipe as DesignRecipe)) {
    throw new Error("recipe must be one of: corporate, luxury, saas.");
  }

  const animation = body.animation ?? "subtle";
  if (typeof animation !== "string" || !ANIMATIONS.has(animation as AnimationLevel)) {
    throw new Error("animation must be one of: none, subtle, expressive.");
  }

  return {
    name,
    slug,
    description: typeof body.description === "string" ? body.description.trim() : undefined,
    private: typeof body.private === "boolean" ? body.private : true,
    recipe: recipe as DesignRecipe,
    animation: animation as AnimationLevel,
    heroTitle: typeof body.heroTitle === "string" ? body.heroTitle.trim() : undefined,
    heroSubtitle: typeof body.heroSubtitle === "string" ? body.heroSubtitle.trim() : undefined,
    primaryCtaLabel: typeof body.primaryCtaLabel === "string" ? body.primaryCtaLabel.trim() : undefined,
    primaryCtaHref: typeof body.primaryCtaHref === "string" ? body.primaryCtaHref.trim() : undefined
  };
}
