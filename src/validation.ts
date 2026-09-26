import type {
  AnimationLevel,
  ConversionGoal,
  CreateProjectRequest,
  DesktopPlatform,
  DesktopPreset,
  DesignRecipe,
  GenerationEngine,
  MobilePlatform,
  MobilePreset,
  ProjectLanguage,
  ProjectType,
  ServicePreset,
  WebAppPreset
} from "./types";

const RECIPES = new Set<DesignRecipe>(["corporate", "luxury", "saas"]);
const ANIMATIONS = new Set<AnimationLevel>(["none", "subtle", "expressive"]);
const LANGUAGES = new Set<ProjectLanguage>(["fr", "en"]);
const ENGINES = new Set<GenerationEngine>(["native", "openpage"]);
const PROJECT_TYPES = new Set<ProjectType>(["landing", "service", "mobile", "desktop", "webapp", "profile"]);
const SERVICE_PRESETS = new Set<ServicePreset>(["entitlements"]);
const MOBILE_PLATFORMS = new Set<MobilePlatform>(["android"]);
const MOBILE_PRESETS = new Set<MobilePreset>(["android-compose"]);
const DESKTOP_PLATFORMS = new Set<DesktopPlatform>(["windows"]);
const DESKTOP_PRESETS = new Set<DesktopPreset>(["tauri-react"]);
const WEBAPP_PRESETS = new Set<WebAppPreset>(["react-vite"]);
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
  const slug = requestedSlug === ".github" ? ".github" : slugify(requestedSlug || name);

  if (!slug || (slug !== ".github" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) {
    throw new Error("A valid repository slug could not be produced.");
  }

  const projectType = body.projectType ?? "landing";
  if (typeof projectType !== "string" || !PROJECT_TYPES.has(projectType as ProjectType)) {
    throw new Error("projectType must be one of: landing, service, mobile, desktop, webapp, profile.");
  }

  const preset = body.preset;
  const platform = body.platform;
  if (projectType === "profile") {
    return {
      ...result,
      projectType: "profile"
    };
  }

  if (projectType === "service") {
    if (typeof preset !== "string" || !SERVICE_PRESETS.has(preset as ServicePreset)) {
      throw new Error("service projects require preset: entitlements.");
    }
    if (platform !== undefined) {
      throw new Error("platform is not valid when projectType is service.");
    }
  } else if (projectType === "mobile") {
    if (typeof platform !== "string" || !MOBILE_PLATFORMS.has(platform as MobilePlatform)) {
      throw new Error("mobile projects require platform: android.");
    }
    if (typeof preset !== "string" || !MOBILE_PRESETS.has(preset as MobilePreset)) {
      throw new Error("android mobile projects require preset: android-compose.");
    }
  } else if (projectType === "desktop") {
    if (typeof platform !== "string" || !DESKTOP_PLATFORMS.has(platform as DesktopPlatform)) {
      throw new Error("desktop projects require platform: windows.");
    }
    if (typeof preset !== "string" || !DESKTOP_PRESETS.has(preset as DesktopPreset)) {
      throw new Error("windows desktop projects require preset: tauri-react.");
    }
  } else if (projectType === "webapp") {
    if (typeof preset !== "string" || !WEBAPP_PRESETS.has(preset as WebAppPreset)) {
      throw new Error("webapp projects require preset: react-vite.");
    }
    if (platform !== undefined) {
      throw new Error("platform is not valid when projectType is webapp.");
    }
  } else if (preset !== undefined || platform !== undefined) {
    throw new Error("preset and platform are only valid for service, mobile, desktop or webapp projects.");
  }

  if (projectType === "profile" && slug !== ".github") {
    throw new Error("profile projects must use slug: .github.");
  }

  if (projectType === "profile" && body.private === true) {
    throw new Error("profile projects must be public.");
  }

  const language = body.language ?? "en";
  if (typeof language !== "string" || !LANGUAGES.has(language as ProjectLanguage)) {
    throw new Error("language must be one of: fr, en.");
  }

  const engine = body.engine ?? "native";
  if (typeof engine !== "string" || !ENGINES.has(engine as GenerationEngine)) {
    throw new Error("engine must be one of: native, openpage.");
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

  const result: CreateProjectRequest & { slug: string } = {
    name,
    slug,
    description: optionalTrimmedString(body, "description", 300),
    private: projectType === "profile" ? false : typeof body.private === "boolean" ? body.private : true,
    brief: optionalTrimmedString(body, "brief", 2000),
    language: language as ProjectLanguage,
    audience: optionalTrimmedString(body, "audience", 300),
    goal: goal as ConversionGoal | undefined,
    engine: engine as GenerationEngine,
    recipe: recipe as DesignRecipe | undefined,
    animation: animation as AnimationLevel | undefined,
    heroTitle: optionalTrimmedString(body, "heroTitle", 160),
    heroSubtitle: optionalTrimmedString(body, "heroSubtitle", 400),
    primaryCtaLabel: optionalTrimmedString(body, "primaryCtaLabel", 80),
    primaryCtaHref: optionalTrimmedString(body, "primaryCtaHref", 500)
  };

  if (projectType === "service") {
    return {
      ...result,
      projectType: "service",
      preset: preset as ServicePreset
    };
  }

  if (projectType === "mobile") {
    return {
      ...result,
      projectType: "mobile",
      platform: platform as MobilePlatform,
      preset: preset as MobilePreset
    };
  }

  if (projectType === "desktop") {
    return {
      ...result,
      projectType: "desktop",
      platform: platform as DesktopPlatform,
      preset: preset as DesktopPreset
    };
  }

  if (projectType === "webapp") {
    return {
      ...result,
      projectType: "webapp",
      preset: preset as WebAppPreset
    };
  }

  return result;
}
