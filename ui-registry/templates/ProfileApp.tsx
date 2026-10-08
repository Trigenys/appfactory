import { UiButton } from "./components/ui/UiButton";
import { UiCard } from "./components/ui/UiCard";
import "./components/ui/ui.css";

export default function App() {
  return (
    <main className="tg-app-shell">
      <div className="tg-container">
        <header className="tg-hero">
          <p className="tg-eyebrow">Trigenys AppFactory · UI Registry v1</p>
          <h1>__APP_NAME__</h1>
          <p className="tg-lede">
            Your branded UI foundation is ready. Replace this demo with your real product requirements.
          </p>
          <UiButton onClick={() => document.getElementById("capabilities")?.scrollIntoView({ behavior: "smooth" })}>
            Explore the foundation
          </UiButton>
        </header>
        <section id="capabilities" className="tg-grid" aria-label="UI foundation capabilities">
          <UiCard>
            <h2>Consistent tokens</h2>
            <p>Brand identity, readable typography and reusable component styles.</p>
          </UiCard>
          <UiCard>
            <h2>Accessible primitives</h2>
            <p>Semantic elements, visible focus and reduced-motion support.</p>
          </UiCard>
          <UiCard>
            <h2>Product ownership</h2>
            <p>Components are source-controlled in your repository and work without marketplace uptime.</p>
          </UiCard>
        </section>
      </div>
    </main>
  );
}
