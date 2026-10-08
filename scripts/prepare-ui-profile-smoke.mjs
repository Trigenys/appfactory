#!/usr/bin/env node
// CI-only renderer: compiles the same allowlisted sources/tokens copied by webapp provisioning.
// Runs on disposable GitHub Actions workspace, never writes back to a user repository.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv[2];
const data = JSON.parse(fs.readFileSync(path.join(root, "ui-registry/profiles.json"), "utf8"));
if (!Object.hasOwn(data.profiles, profile)) {
  throw new Error(`Invalid UI smoke test profile: ${profile}`);
}
const targetRoot = path.join(root, "blueprints/react-vite");
const sources = [
  ["ui-registry/templates/ProfileApp.tsx", "src/App.tsx"],
  ["ui-registry/templates/ProfileStyles.css", "src/styles.css"],
  ["ui-registry/components/UiButton.tsx", "src/components/ui/UiButton.tsx"],
  ["ui-registry/components/UiCard.tsx", "src/components/ui/UiCard.tsx"],
  ["ui-registry/components/WhatsAppCta.tsx", "src/components/ui/WhatsAppCta.tsx"],
  ["ui-registry/components/ui.css", "src/components/ui/ui.css"]
];

for (const [source, destination] of sources) {
  const target = path.join(targetRoot, destination);
  let content = fs.readFileSync(path.join(root, source), "utf8");
  content = content.replaceAll("__APP_NAME__", "UI Registry Smoke Test");
  if (destination === "src/styles.css") {
    for (const [key, value] of Object.entries(data.profiles[profile].tokens)) {
      content = content.replaceAll(`__UI_${key.toUpperCase()}__`, value);
    }
    if (/__UI_[A-Z_]+__/.test(content)) throw new Error("Unresolved smoke test token.");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
process.stdout.write(`Prepared UI profile ${profile} for React/Vite compilation.\n`);
