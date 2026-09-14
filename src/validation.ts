import type {
  AnimationLevel,
  ConversionGoal,
  CreateProjectRequest,
  DesignRecipe,
  ProjectLanguage
} from "./types";

const RECIPES = new Set<DesignRecipe>(["corporate", "luxury", "saas"]);
const ANIMATIONS = new Set<AnimationLevel>(["none", "subtle", "expressive"]);
const LANGUAGES = new Set<ProjectLanguage>(["fr", "en"]);
const GOALS = new Set<ConversionGoal>(["leads", "bookings", "sales", "signup", "contact", "awareness"]);

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

function optionalTrimmedString(body: Record<string, unknown>, key: string, maxLength: number): string | undefined {
  if (body[key] === undefined) return undefined;
  if (typeof body[key] !== "string") throw new Error(`${key} must be a string.`);
  const value = body[key].trim();
  if (!value) return undefined;
  if (value.length > maxLength) throw new Error(`${key} must be at most ${maxLength} characters.`);
  return value;
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

  const language = body.language ?? "en";
  if (typeof language !== "string" || !LANGUAGES.has(language as ProjectLanguage)) {
    throw new Error("language must be one of: fr, en.");
  }

  const recipe = body.recipe;
  if (recipe !== undefined && (typeof recipe !== "string" || !RECIPES.has(recipe as DesignRecipe))) {
    throw new Error("recipe must be one of: corporate, luxury, saas.");
  }

  const animation = body.animation;
  if (
    animation !== undefined &&
    (typeof animation !== "string" || !ANIMATIONS.has(animation as AnimationLevel))
  ) {
    throw new Error("animation must be one of: none, subtle, expressive.");
  }

  const goal = body.goal;
  if (goal !== undefined && (typeof goal !== "string" || !GOALS.has(goal as ConversionGoal))) {
    throw new Error("goal must be one of: leads, bookings, sales, signup, contact, awareness.");
  }

  return {
    name,
    slug,
    description: optionalTrimmedString(body, "description", 300),
    private: typeof body.private === "boolean" ? body.private : true,
    brief: optionalTrimmedString(body, "brief", 2000),
    language: language as ProjectLanguage,
    audience: optionalTrimmedString(body, "audience", 300),
    goal: goal as ConversionGoal | undefined,
    recipe: recipe as DesignRecipe | undefined,
    animation: animation as AnimationLevel | undefined,
    heroTitle: optionalTrimmedString(body, "heroTitle", 160),
    heroSubtitle: optionalTrimmedString(body, "heroSubtitle", 400),
    primaryCtaLabel: optionalTrimmedString(body, "primaryCtaLabel", 80),
    primaryCtaHref: optionalTrimmedString(body, "primaryCtaHref", 500)
  };
}
