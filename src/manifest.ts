import { buildProjectSpecification } from "./specification";
import type { ConversionGoal, CreateProjectRequest, Industry, ProjectLanguage } from "./types";

function defaultCta(goal: ConversionGoal, language: ProjectLanguage): string {
  const labels: Record<ConversionGoal, { fr: string; en: string }> = {
    leads: { fr: "Demander un devis", en: "Request a quote" },
    bookings: { fr: "Prendre rendez-vous", en: "Book a consultation" },
    sales: { fr: "Découvrir l'offre", en: "Explore the offer" },
    signup: { fr: "Commencer", en: "Get started" },
    contact: { fr: "Nous contacter", en: "Contact us" },
    awareness: { fr: "En savoir plus", en: "Learn more" }
  };
  return labels[goal][language];
}

function defaultHeroTitle(name: string, industry: Industry, language: ProjectLanguage): string {
  const suffixes: Record<Industry, { fr: string; en: string }> = {
    legal: { fr: "le conseil pour avancer avec confiance.", en: "counsel for what comes next." },
    technology: { fr: "la technologie pensée pour avancer vite.", en: "technology built for momentum." },
    finance: { fr: "des décisions financières plus claires.", en: "clearer financial decisions." },
    healthcare: { fr: "une expérience de santé plus simple.", en: "a simpler healthcare experience." },
    education: { fr: "apprendre, progresser, aller plus loin.", en: "learn, progress, go further." },
    logistics: { fr: "avancez avec certitude.", en: "move with certainty." },
    "real-estate": { fr: "l'immobilier avec une vision claire.", en: "real estate with a clearer view." },
    ecommerce: { fr: "une meilleure façon de choisir.", en: "a better way to choose." },
    hospitality: { fr: "des expériences qui donnent envie de revenir.", en: "experiences worth returning to." },
    creative: { fr: "des idées qui prennent forme.", en: "ideas made tangible." },
    general: { fr: "prêt pour la suite.", en: "ready for what comes next." }
  };
  return `${name}, ${suffixes[industry][language]}`;
}

function defaultFeatures(industry: Industry, language: ProjectLanguage) {
  const sector = industry === "general" ? (language === "fr" ? "votre activité" : "your business") : industry;
  if (language === "fr") {
    return [
      {
        title: "Une proposition claire",
        description: `Une présentation structurée qui aide les visiteurs à comprendre rapidement la valeur de ${sector}.`
      },
      {
        title: "Pensé pour convertir",
        description: "Une hiérarchie de contenu et des appels à l'action alignés sur l'objectif principal du site."
      },
      {
        title: "Prêt à évoluer",
        description: "Une base modulaire, responsive et automatisée qui peut grandir avec le projet."
      }
    ];
  }

  return [
    {
      title: "A clear proposition",
      description: `Structured content helps visitors understand the value of ${sector} quickly.`
    },
    {
      title: "Designed to convert",
      description: "Content hierarchy and calls to action stay aligned with the site's primary goal."
    },
    {
      title: "Ready to evolve",
      description: "A modular, responsive and automated foundation that can grow with the project."
    }
  ];
}

export function buildLandingManifest(input: CreateProjectRequest & { slug: string }) {
  const specification = buildProjectSpecification(input);
  const language = specification.language;
  const primaryLabel = input.primaryCtaLabel || defaultCta(specification.goal, language);
  const primaryHref = input.primaryCtaHref || "#contact";
  const hero = {
    eyebrow: language === "fr" ? "Conçu avec AppFactory" : "Generated with AppFactory",
    title: input.heroTitle || defaultHeroTitle(input.name, specification.industry, language),
    subtitle: input.heroSubtitle || specification.brief,
    primaryCta: {
      label: primaryLabel,
      href: primaryHref
    },
    secondaryCta: {
      label: language === "fr" ? "Découvrir" : "Discover more",
      href: "#capabilities"
    }
  };
  const features = defaultFeatures(specification.industry, language);
  const finalCta = {
    title:
      language === "fr"
        ? `Prêt à avancer avec ${input.name} ?`
        : `Ready to move forward with ${input.name}?`,
    subtitle:
      language === "fr"
        ? "Passez à l'étape suivante avec une action simple et claire."
        : "Take the next step with one clear action.",
    label: primaryLabel,
    href: primaryHref
  };

  return {
    $schema: "./appfactory.schema.json",
    schemaVersion: 2,
    project: {
      name: input.name,
      slug: input.slug,
      language
    },
    strategy: {
      brief: specification.brief,
      audience: specification.audience || null,
      industry: specification.industry,
      tone: specification.tone,
      goal: specification.goal
    },
    brand: {
      tone: specification.tone,
      palette: specification.design.palette,
      typography: specification.design.typography
    },
    design: {
      recipe: specification.design.recipe,
      animation: specification.design.animation,
      density: specification.design.density
    },
    sections: specification.sections,
    seo: {
      title: `${input.name} — ${hero.title}`.slice(0, 70),
      description: hero.subtitle.slice(0, 160)
    },
    motion: {
      level: specification.design.animation,
      respectReducedMotion: true
    },
    content: {
      hero,
      features,
      finalCta
    },
    // Compatibility bridge for the current renderer. M3.4 will consume content/sections directly.
    hero,
    features,
    finalCta
  };
}
