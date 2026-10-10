import "./wow-frontend-adapters.test.mjs";
import "./wow-frontend-skill.test.mjs";
import "./wow-frontend-security.test.mjs";
import "./wow-frontend-contract.test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");

test("all four configured UI directions have complete, safe CSS tokens", () => {
  const { version, profiles } = JSON.parse(read("ui-registry/profiles.json"));
  assert.equal(version, 1);
  assert.equal(Object.keys(profiles).length, 4);
  const template = read("ui-registry/templates/ProfileStyles.css");
  for (const [name, profile] of Object.entries(profiles)) {
    let css = template;
    for (const key of ["bg", "surface", "text", "muted", "accent", "border", "radius"]) {
      assert.ok(profile.tokens[key], `${name} lacks ${key}`);
      assert.match(profile.tokens[key], /^(#[0-9a-f]{6}|[0-9]{1,2}px)$/i);
      css = css.replaceAll(`__UI_${key.toUpperCase()}__`, profile.tokens[key]);
    }
    assert.doesNotMatch(css, /__UI_[A-Z_]+__/);
  }
});

test("catalog paths resolve to owned source and no external component code is bundled", () => {
  const catalog = JSON.parse(read("ui-registry/registry.json"));
  const provenance = JSON.parse(read("ui-registry/provenance.json"));
  assert.equal(catalog.name, "trigenys-ui");
  assert.equal(provenance.thirdPartyCodeImported, false);
  assert.equal(provenance.dependencies.length, 0);
  for (const item of catalog.items) {
    assert.ok(provenance.items.includes(item.name), `missing provenance for ${item.name}`);
    for (const file of item.files) assert.ok(fs.existsSync(file.path), `missing registry file ${file.path}`);
  }
});

test("TypeScript syntax of all shipped TSX components is valid", () => {
  for (const path of [
    "ui-registry/components/UiButton.tsx",
    "ui-registry/components/UiCard.tsx",
    "ui-registry/components/WhatsAppCta.tsx",
    "ui-registry/templates/ProfileApp.tsx"
  ]) {
    const { diagnostics = [] } = ts.transpileModule(read(path), {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
    });
    assert.equal(diagnostics.length, 0, `${path}: ${diagnostics.map((d) => d.messageText).join(", ")}`);
  }
});

test("provisioning is opt-in and copies its components without network runtime dependency", () => {
  const source = read("src/webapp-provisioning.ts");
  assert.match(source, /uiProfile \? \[/);
  assert.match(source, /UI_REGISTRY_VERSION = 1/);
  assert.match(source, /profileExtras/);
  assert.match(source, /marker.uiProfile !== input.uiProfile/);
  assert.match(source, /ui-registry\/components\/UiButton.tsx/);
});
