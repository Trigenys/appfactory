import type { CreateProjectRequest } from "./types";

export function buildLandingManifest(input: CreateProjectRequest & { slug: string }) {
  return {
    $schema: "./appfactory.schema.json",
    schemaVersion: 1,
    project: {
      name: input.name,
      slug: input.slug
    },
    design: {
      recipe: input.recipe ?? "corporate",
      animation: input.animation ?? "subtle"
    },
    hero: {
      eyebrow: "Generated with AppFactory",
      title: input.heroTitle || `${input.name}, ready for the web.`,
      subtitle:
        input.heroSubtitle ||
        "A production-ready landing page generated from the AppFactory template and configured through a controlled manifest.",
      primaryCta: {
        label: input.primaryCtaLabel || "Get started",
        href: input.primaryCtaHref || "#contact"
      },
      secondaryCta: {
        label: "Discover more",
        href: "#capabilities"
      }
    },
    features: [
      {
        title: "Clear by design",
        description: "Structured content keeps the value proposition readable, focused and easy to evolve."
      },
      {
        title: "Responsive by default",
        description: "The AppFactory landing template is designed to work across mobile, tablet and desktop layouts."
      },
      {
        title: "Automation-ready",
        description: "Repository creation, configuration and CI are prepared for an end-to-end delivery pipeline."
      }
    ],
    finalCta: {
      title: `Start a conversation with ${input.name}.`,
      subtitle: "Replace this placeholder CTA with the project's real conversion action during generation.",
      label: input.primaryCtaLabel || "Get started",
      href: input.primaryCtaHref || "#contact"
    }
  };
}
