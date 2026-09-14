import type {
  AnimationLevel,
  BrandTone,
  ConversionGoal,
  CreateProjectRequest,
  DesignRecipe,
  Industry,
  ProjectSpecification,
  SectionKind
} from "./types";

const INDUSTRY_KEYWORDS: Array<[Industry, string[]]> = [
  ["legal", ["legal", "law", "lawyer", "attorney", "avocat", "juridique", "cabinet d'avocat"]],
  ["technology", ["software", "saas", "app", "platform", "tech", "technology", "logiciel", "plateforme", "startup"]],
  ["finance", ["finance", "bank", "fintech", "investment", "investissement", "banque", "assurance"]],
  ["healthcare", ["health", "clinic", "medical", "doctor", "sante", "santé", "clinique", "médecin", "medecin"]],
  ["education", ["school", "academy", "education", "training", "école", "ecole", "formation", "université", "universite"]],
  ["logistics", ["logistics", "delivery", "shipping", "transport", "fleet", "logistique", "livraison"]],
  ["real-estate", ["real estate", "property", "immobilier", "property management"]],
  ["ecommerce", ["ecommerce", "e-commerce", "shop", "store", "retail", "boutique", "commerce"]],
  ["hospitality", ["hotel", "restaurant", "travel", "tourism", "hôtel", "hotel", "voyage", "tourisme"]],
  ["creative", ["creative", "agency", "studio", "design", "portfolio", "agence", "créatif", "creatif"]]
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(normalize(keyword)));
}

function inferIndustry(text: string): Industry {
  for (const [industry, keywords] of INDUSTRY_KEYWORDS) {
    if (includesAny(text, keywords)) return industry;
  }
  return "general";
}

function inferTone(text: string): BrandTone {
  if (includesAny(text, ["premium", "luxury", "luxe", "haut de gamme", "exclusive", "élégant", "elegant"])) {
    return "premium";
  }
  if (includesAny(text, ["bold", "edgy", "energetic", "disruptive", "audacieux", "impactant", "créatif", "creatif"])) {
    return "bold";
  }
  if (includesAny(text, ["friendly", "warm", "human", "accessible", "chaleureux", "humain", "convivial"])) {
    return "friendly";
  }
  if (includesAny(text, ["minimal", "minimalist", "clean", "simple", "sobre", "épuré", "epure"])) {
    return "minimal";
  }
  return "professional";
}

function inferGoal(text: string, explicit?: ConversionGoal): ConversionGoal {
  if (explicit) return explicit;
  if (includesAny(text, ["book", "booking", "appointment", "rendez-vous", "rendez vous", "consultation", "reservation", "réservation"])) {
    return "bookings";
  }
  if (includesAny(text, ["buy", "purchase", "checkout", "sell", "vente", "acheter", "commande", "shop", "boutique"])) {
    return "sales";
  }
  if (includesAny(text, ["signup", "sign up", "register", "inscription", "s'inscrire", "essai gratuit", "free trial"])) {
    return "signup";
  }
  if (includesAny(text, ["lead", "quote", "devis", "prospect", "demande", "request"])) return "leads";
  if (includesAny(text, ["contact", "call", "email", "appeler", "contacter"])) return "contact";
  return "awareness";
}

function inferRecipe(industry: Industry, tone: BrandTone, explicit?: DesignRecipe): DesignRecipe {
  if (explicit) return explicit;
  if (tone === "premium") return "luxury";
  if (industry === "technology" || tone === "bold") return "saas";
  return "corporate";
}

function inferAnimation(tone: BrandTone, industry: Industry, explicit?: AnimationLevel): AnimationLevel {
  if (explicit) return explicit;
  if (tone === "minimal" || tone === "premium" || industry === "legal" || industry === "finance") return "subtle";
  if (tone === "bold" || industry === "creative") return "expressive";
  return "subtle";
}

function inferSections(industry: Industry, goal: ConversionGoal): SectionKind[] {
  const sections: SectionKind[] = ["hero", "trust"];

  if (["legal", "finance", "healthcare", "education", "logistics", "hospitality", "real-estate"].includes(industry)) {
    sections.push("services");
  } else {
    sections.push("features");
  }

  sections.push("process", "testimonials");
  if (industry === "technology" && goal === "sales") sections.push("pricing");
  sections.push("faq");
  if (goal === "bookings" || goal === "contact" || goal === "leads") sections.push("contact");
  sections.push("final-cta");
  return sections;
}

export function buildProjectSpecification(input: CreateProjectRequest & { slug: string }): ProjectSpecification {
  const brief = input.brief || input.description || input.heroSubtitle || `${input.name} landing page`;
  const text = normalize(`${input.name} ${brief} ${input.audience || ""}`);
  const industry = inferIndustry(text);
  const tone = inferTone(text);
  const goal = inferGoal(text, input.goal);
  const recipe = inferRecipe(industry, tone, input.recipe);
  const animation = inferAnimation(tone, industry, input.animation);

  return {
    brief,
    language: input.language || "en",
    audience: input.audience,
    industry,
    tone,
    goal,
    design: {
      recipe,
      animation,
      palette: recipe === "luxury" ? "midnight-gold" : recipe === "saas" ? "electric-indigo" : "navy-mint",
      typography: recipe === "luxury" ? "editorial" : recipe === "saas" ? "geometric" : "grotesk",
      density: tone === "minimal" || tone === "premium" ? "airy" : "balanced"
    },
    sections: inferSections(industry, goal)
  };
}
