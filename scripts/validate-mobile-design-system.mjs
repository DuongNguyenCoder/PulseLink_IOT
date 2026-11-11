import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const canonical = path.join(root, "docs", "design-system", "mobile");
const codex = path.join(root, ".agents", "skills", "pulselink-mobile-design-system", "SKILL.md");
const claude = path.join(root, ".claude", "skills", "pulselink-mobile-design-system", "SKILL.md");
const requiredDocs = [
  "README.md", "design-philosophy.md", "design-principles.md", "design-tokens.md",
  "typography.md", "color-system.md", "layout-and-spacing.md", "component-system.md",
  "navigation-system.md", "interaction-patterns.md", "accessibility-standard.md",
  "ios-guidelines.md", "android-guidelines.md", "react-native-guidelines.md",
  "pulselink-ux-patterns.md", "design-review-checklist.md", "references.md",
];

const failures = [];
const exists = (file) => fs.existsSync(file);
for (const file of requiredDocs) if (!exists(path.join(canonical, file))) failures.push(`missing canonical document: ${file}`);
if (!exists(codex)) failures.push("missing Codex skill entry point");
if (!exists(claude)) failures.push("missing Claude Code skill entry point");

if (exists(codex) && exists(claude)) {
  const codexText = fs.readFileSync(codex, "utf8");
  const claudeText = fs.readFileSync(claude, "utf8");
  if (codexText !== claudeText) failures.push("Codex and Claude skill entry points differ");
  for (const reference of ["docs/design-system/mobile/", "references.md", "design-review-checklist.md"]) {
    if (!codexText.includes(reference)) failures.push(`skill does not reference ${reference}`);
  }
}

const markdownFiles = requiredDocs.map((file) => path.join(canonical, file)).filter(exists);
for (const file of markdownFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = match[1];
    if (/^https?:\/\//.test(target) || target.startsWith("mailto:")) continue;
    if (!exists(path.resolve(path.dirname(file), target))) failures.push(`broken link in ${path.relative(root, file)}: ${target}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${requiredDocs.length} canonical documents, matching Codex/Claude skills, and local links validated.`);
}
