# AppFactory — Visual Direction Library

This document captures the visual directions Jennifer selected as reference standards for AppFactory-generated interfaces.

The goal is not to copy a specific layout. These are reusable art-direction profiles that can guide page generation, component styling, image selection, spacing, typography and CTA treatment according to the product context.

## Shared baseline

Across all profiles:

- Clear visual hierarchy.
- Generous whitespace; avoid dense, cramped layouts.
- Strong product/service photography when imagery is used.
- Rounded cards and controls, but without excessive "bubble UI".
- High-contrast, obvious primary CTAs.
- Fine, restrained iconography.
- Consistent spacing rhythm and modular sections.
- Premium finish without decorative overload.
- Responsive composition must preserve hierarchy, not merely stack everything vertically.
- Trust elements should feel integrated into the interface rather than appended as generic badges.

---

## 1. Editorial Lifestyle Premium

**Preset ID:** `editorial-lifestyle-premium`

### Character

Warm, premium, editorial and lifestyle-oriented. The interface should feel crafted, aspirational and high-end while remaining easy to scan.

### Visual language

- Cream / ivory background rather than pure white.
- Deep forest green as the dominant brand color.
- Soft mustard, warm gold or muted amber as accent colors.
- Large, high-quality lifestyle/product photography.
- Elegant serif display headings paired with a clean sans-serif body typeface.
- Rounded cards with subtle borders/shadows.
- Airy section spacing and deliberate asymmetry when useful.
- Contrasted but refined CTAs.
- Editorial content blocks mixed with commercial conversion sections.

### Useful modules

- Immersive hero.
- Services / categories.
- Featured products or signature offers.
- Brand story / about section.
- Trust badges.
- Testimonials.
- Stats / proof points.
- Gallery.
- Editorial content / articles.
- Large conversion CTA before the footer.

### Best suited to

Hospitality, catering, food, beauty, fashion, premium retail, events, lifestyle brands and other businesses where atmosphere and perceived quality strongly influence conversion.

### Avoid

- Stark SaaS-like white/blue styling.
- Too many saturated colors.
- Dense grids.
- Generic stock imagery.
- Excessive glassmorphism or visual effects.

---

## 2. Tech Commerce Premium

**Preset ID:** `tech-commerce-premium`

### Character

Product-first, sharp, modern and conversion-focused. Designed especially for mobile commerce and products where visual desirability matters.

### Visual language

- White or very light neutral background.
- One strong accent color used with discipline; red is a strong reference direction.
- Dramatic, realistic, large product visuals.
- Clean modern sans-serif typography.
- Strong whitespace and minimal chrome.
- Large rounded CTA buttons.
- Lightweight icons and compact navigation.
- Product cards with clear hierarchy.
- Product detail screens that foreground imagery, price, rating and variants.

### Useful modules

- Full-screen or near-full-screen onboarding/hero.
- Product discovery.
- Category chips / filters.
- Featured products.
- Ratings and review counts.
- Promotional badges.
- Product variants: color, size, configuration.
- Wishlist.
- Sticky or highly visible add-to-cart CTA.
- Bottom mobile navigation when appropriate.

### Best suited to

Electronics, automotive, motorcycles, fashion accessories, consumer hardware, marketplaces and mobile-first retail.

### Avoid

- Overdecorated backgrounds.
- Too much copy above the fold.
- Multiple competing accent colors.
- Tiny product imagery.
- Hiding price or primary actions behind secondary interactions.

---

## 3. Professional Service Premium

**Preset ID:** `professional-service-premium`

### Character

Credible, reassuring and institutionally polished without looking old-fashioned. It should communicate trust, competence and clarity.

### Visual language

- White / very light blue base.
- Deep navy for high-trust sections.
- Green, mint or turquoise accents.
- Human/professional photography in the hero.
- Clean sans-serif typography with strong information hierarchy.
- Modular service cards with substantial whitespace.
- Dark CTA bands used to punctuate long pages.
- Calm iconography and restrained shadows.
- Reassurance through proof, expertise and service clarity rather than decorative luxury.

### Useful modules

- Hero with primary service CTA.
- Search / appointment / service finder.
- Service categories.
- Trust metrics.
- Expert / professional profiles.
- Testimonials.
- Benefits / reasons to choose.
- Educational articles.
- Mobile-app promotion.
- Security/privacy reassurance.
- Strong closing CTA and structured footer.

### Best suited to

Healthcare, insurance, banking, fintech, education, public-service portals, B2B SaaS and professional-service platforms.

### Avoid

- Cold "enterprise grey" layouts.
- Dense dashboard aesthetics on public-facing landing pages.
- Overuse of gradients.
- Trust badges without supporting context.
- Visual language that feels playful when the domain requires reassurance.

---

## Selection rule for AppFactory

AppFactory should choose the profile from the business and conversion context, not from an arbitrary industry-to-template mapping.

Use:

- `editorial-lifestyle-premium` when emotion, atmosphere, craftsmanship or lifestyle perception is central to conversion.
- `tech-commerce-premium` when the product itself is the main visual object and fast commerce interaction matters.
- `professional-service-premium` when trust, expertise, clarity and service credibility are primary.

If a product sits between profiles, combine only compatible traits. Do not merge entire visual systems blindly.

## Product principle

These profiles are **directions, not fixed templates**.

AppFactory should preserve the product's identity, content model and conversion flow while using the selected profile to influence:

1. palette,
2. typography,
3. spacing,
4. image treatment,
5. card styling,
6. CTA hierarchy,
7. section composition,
8. trust presentation,
9. responsive behavior.

The generated result should feel intentionally designed for the product, not like the same template with different colors.
