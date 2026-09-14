import { buildProjectSpecification } from "./specification";
import type {
  ConversionGoal,
  CreateProjectRequest,
  Industry,
  ProjectLanguage,
  ProjectSpecification
} from "./types";

type CardItem = { title: string; description: string };

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

function industryLabel(industry: Industry, language: ProjectLanguage): string {
  const labels: Record<Industry, { fr: string; en: string }> = {
    legal: { fr: "conseil juridique", en: "legal counsel" },
    technology: { fr: "technologie", en: "technology" },
    finance: { fr: "services financiers", en: "financial services" },
    healthcare: { fr: "santé", en: "healthcare" },
    education: { fr: "éducation", en: "education" },
    logistics: { fr: "logistique", en: "logistics" },
    "real-estate": { fr: "immobilier", en: "real estate" },
    ecommerce: { fr: "commerce", en: "commerce" },
    hospitality: { fr: "hospitalité", en: "hospitality" },
    creative: { fr: "création", en: "creative work" },
    general: { fr: "activité", en: "business" }
  };
  return labels[industry][language];
}

function defaultFeatures(industry: Industry, language: ProjectLanguage): CardItem[] {
  const sector = industryLabel(industry, language);
  if (language === "fr") {
    return [
      {
        title: "Une proposition claire",
        description: `Une présentation structurée qui aide les visiteurs à comprendre rapidement la valeur de votre ${sector}.`
      },
      {
        title: "Pensé pour convertir",
        description: "Une hiérarchie de contenu et des appels à l'action alignés sur l'objectif principal du site."
      },
      {
        title: "Prêt à évoluer",
        description: "Une base modulaire et responsive qui peut grandir avec le projet."
      }
    ];
  }

  return [
    {
      title: "A clear proposition",
      description: `Structured content helps visitors understand the value of your ${sector} quickly.`
    },
    {
      title: "Designed to convert",
      description: "Content hierarchy and calls to action stay aligned with the site's primary goal."
    },
    {
      title: "Ready to evolve",
      description: "A modular and responsive foundation that can grow with the project."
    }
  ];
}

function defaultServices(industry: Industry, language: ProjectLanguage): CardItem[] {
  const titles: Record<Industry, { fr: string[]; en: string[] }> = {
    legal: {
      fr: ["Structuration & contrats", "Gouvernance & conformité", "Croissance & opérations"],
      en: ["Structure & contracts", "Governance & compliance", "Growth & operations"]
    },
    technology: {
      fr: ["Produit & plateforme", "Automatisation & intégration", "Déploiement & évolution"],
      en: ["Product & platform", "Automation & integration", "Delivery & evolution"]
    },
    finance: {
      fr: ["Pilotage financier", "Risque & conformité", "Décision & croissance"],
      en: ["Financial steering", "Risk & compliance", "Decision & growth"]
    },
    healthcare: {
      fr: ["Parcours patient", "Coordination des soins", "Expérience & suivi"],
      en: ["Patient journey", "Care coordination", "Experience & follow-up"]
    },
    education: {
      fr: ["Parcours d'apprentissage", "Accompagnement", "Progression & résultats"],
      en: ["Learning journey", "Guidance", "Progress & outcomes"]
    },
    logistics: {
      fr: ["Planification", "Opérations & suivi", "Performance du réseau"],
      en: ["Planning", "Operations & tracking", "Network performance"]
    },
    "real-estate": {
      fr: ["Sélection", "Transaction", "Gestion & valorisation"],
      en: ["Selection", "Transaction", "Management & value"]
    },
    ecommerce: {
      fr: ["Découverte", "Conversion", "Fidélisation"],
      en: ["Discovery", "Conversion", "Retention"]
    },
    hospitality: {
      fr: ["Découverte", "Réservation", "Expérience client"],
      en: ["Discovery", "Booking", "Guest experience"]
    },
    creative: {
      fr: ["Stratégie", "Identité & création", "Activation"],
      en: ["Strategy", "Identity & creation", "Activation"]
    },
    general: {
      fr: ["Conseil", "Mise en œuvre", "Suivi"],
      en: ["Advisory", "Delivery", "Follow-up"]
    }
  };

  const chosen = titles[industry][language];
  return chosen.map((title, index) => ({
    title,
    description:
      language === "fr"
        ? `Un axe de travail clair pour transformer le besoin en action${index === 2 ? " et préparer la suite" : ""}.`
        : `A clear workstream that turns the need into action${index === 2 ? " and prepares what comes next" : ""}.`
  }));
}

function trustContent(specification: ProjectSpecification) {
  const language = specification.language;
  const values =
    specification.design.recipe === "luxury"
      ? language === "fr"
        ? ["Clarté", "Rigueur", "Discrétion"]
        : ["Clarity", "Rigor", "Discretion"]
      : specification.design.recipe === "saas"
        ? language === "fr"
          ? ["Lisibilité", "Vitesse", "Évolutivité"]
          : ["Clarity", "Speed", "Scalability"]
        : language === "fr"
          ? ["Structure", "Fiabilité", "Suivi"]
          : ["Structure", "Reliability", "Follow-through"];

  return {
    eyebrow: language === "fr" ? "Notre approche" : "Our approach",
    title: language === "fr" ? "Une expérience pensée pour inspirer confiance." : "An experience designed to build confidence.",
    items: values.map((value) => ({
      value,
      label:
        language === "fr"
          ? "Un principe qui guide la présentation et le parcours."
          : "A principle that guides the presentation and journey."
    }))
  };
}

function processContent(industry: Industry, language: ProjectLanguage) {
  const titles: Record<Industry, { fr: string[]; en: string[] }> = {
    legal: { fr: ["Cadrer", "Sécuriser", "Avancer"], en: ["Frame", "Secure", "Move forward"] },
    technology: { fr: ["Cadrer", "Construire", "Itérer"], en: ["Frame", "Build", "Iterate"] },
    ecommerce: { fr: ["Attirer", "Convaincre", "Convertir"], en: ["Attract", "Convince", "Convert"] },
    hospitality: { fr: ["Inspirer", "Réserver", "Accueillir"], en: ["Inspire", "Book", "Welcome"] },
    general: { fr: ["Comprendre", "Structurer", "Avancer"], en: ["Understand", "Structure", "Move"] },
    finance: { fr: ["Comprendre", "Sécuriser", "Décider"], en: ["Understand", "Secure", "Decide"] },
    healthcare: { fr: ["Orienter", "Coordonner", "Accompagner"], en: ["Guide", "Coordinate", "Support"] },
    education: { fr: ["Comprendre", "Apprendre", "Progresser"], en: ["Understand", "Learn", "Progress"] },
    logistics: { fr: ["Planifier", "Exécuter", "Suivre"], en: ["Plan", "Execute", "Track"] },
    "real-estate": { fr: ["Cibler", "Décider", "Concrétiser"], en: ["Target", "Decide", "Deliver"] },
    creative: { fr: ["Explorer", "Créer", "Activer"], en: ["Explore", "Create", "Activate"] }
  };
  const chosen = (titles[industry] || titles.general)[language];
  const descriptions =
    language === "fr"
      ? [
          "Clarifier le besoin, les priorités et le résultat attendu.",
          "Transformer cette direction en une réponse structurée et compréhensible.",
          "Créer un prochain pas évident pour faire progresser la relation."
        ]
      : [
          "Clarify the need, priorities and expected outcome.",
          "Turn that direction into a structured and understandable response.",
          "Create an obvious next step that moves the relationship forward."
        ];

  return {
    eyebrow: language === "fr" ? "Méthode" : "Process",
    title: language === "fr" ? "Un parcours simple, sans détour." : "A simple journey without friction.",
    steps: chosen.map((title, index) => ({ title, description: descriptions[index] }))
  };
}

function faqContent(
  input: CreateProjectRequest,
  specification: ProjectSpecification,
  primaryLabel: string
) {
  const language = specification.language;
  if (language === "fr") {
    return {
      eyebrow: "Questions fréquentes",
      title: "Ce qu'il faut savoir avant de commencer.",
      items: [
        {
          question: "À qui s'adresse cette offre ?",
          answer: input.audience
            ? `Elle est pensée en priorité pour ${input.audience}.`
            : `Elle s'adresse aux personnes et organisations qui recherchent une approche claire en ${industryLabel(specification.industry, language)}.`
        },
        {
          question: "Comment démarrer ?",
          answer: `Utilisez l'action « ${primaryLabel} » pour initier le prochain échange.`
        },
        {
          question: "Que se passe-t-il ensuite ?",
          answer: "Le premier échange permet de préciser le besoin, les priorités et la meilleure prochaine étape."
        }
      ]
    };
  }

  return {
    eyebrow: "Frequently asked questions",
    title: "What to know before getting started.",
    items: [
      {
        question: "Who is this for?",
        answer: input.audience
          ? `It is primarily designed for ${input.audience}.`
          : `It is for people and organizations looking for a clear approach to ${industryLabel(specification.industry, language)}.`
      },
      {
        question: "How do I get started?",
        answer: `Use “${primaryLabel}” to start the next conversation.`
      },
      {
        question: "What happens next?",
        answer: "The first conversation clarifies the need, priorities and the most useful next step."
      }
    ]
  };
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
    primaryCta: { label: primaryLabel, href: primaryHref },
    secondaryCta: {
      label: language === "fr" ? "Découvrir" : "Discover more",
      href: "#capabilities"
    }
  };
  const featureItems = defaultFeatures(specification.industry, language);
  const serviceItems = defaultServices(specification.industry, language);
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
    project: { name: input.name, slug: input.slug, language },
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
      trust: trustContent(specification),
      services: {
        eyebrow: language === "fr" ? "Expertise" : "Expertise",
        title:
          language === "fr"
            ? "Des priorités claires, organisées autour de votre besoin."
            : "Clear priorities organized around your need.",
        items: serviceItems
      },
      features: {
        eyebrow: language === "fr" ? "Points forts" : "Highlights",
        title:
          language === "fr"
            ? "Une expérience conçue pour être comprise rapidement."
            : "An experience designed to be understood quickly.",
        items: featureItems
      },
      process: processContent(specification.industry, language),
      faq: faqContent(input, specification, primaryLabel),
      contact: {
        eyebrow: language === "fr" ? "Contact" : "Contact",
        title: language === "fr" ? "Parlons de votre besoin." : "Let's talk about what you need.",
        description:
          language === "fr"
            ? "Un premier échange suffit pour clarifier le contexte et identifier la prochaine étape utile."
            : "One first conversation is enough to clarify the context and identify the most useful next step.",
        cta: { label: primaryLabel, href: primaryHref }
      },
      finalCta
    },
    // Compatibility bridge for generated projects that still use the M2 renderer.
    hero,
    features: featureItems,
    finalCta
  };
}
