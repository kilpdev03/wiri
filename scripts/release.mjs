// Publica una versión de Wiri en GitHub Releases para el actualizador.
//
//   pnpm release -- --notes "Qué cambió"      compila, firma y publica
//   pnpm release -- --dry                     solo compila y genera latest.json
//
// Antes: subir la versión en package.json, src-tauri/Cargo.toml y
// src-tauri/tauri.conf.json, y hacer commit. La clave privada vive fuera del
// repo (por defecto %USERPROFILE%\.tauri\wiri.key; otra con WIRI_SIGNING_KEY).

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = "kilpdev03/wiri";
const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const notesAt = args.indexOf("--notes");
const notes = notesAt >= 0 ? args[notesAt + 1] : "";

const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

// 1. Versión coherente en los tres archivos.
const version = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")).version;
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const cargo = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8").match(/^version = "(.+)"/m)?.[1];
if (pkg !== version || cargo !== version) fail(`Versiones distintas: tauri.conf ${version}, package.json ${pkg}, Cargo.toml ${cargo}`);
const tag = `v${version}`;

// 2. Árbol limpio y versión sin publicar.
if (!dry) {
  if (out("git status --porcelain")) fail("Hay cambios sin commit.");
  if (out(`git tag --list ${tag}`)) fail(`La etiqueta ${tag} ya existe: sube la versión.`);
  if (!notes) fail('Faltan las notas: --notes "Qué cambió"');
}

// 3. Compilar y firmar.
const key = process.env.WIRI_SIGNING_KEY ?? path.join(os.homedir(), ".tauri", "wiri.key");
if (!fs.existsSync(key)) fail(`No encuentro la clave de firma en ${key}`);
console.log(`\n▸ Compilando Wiri ${version}…\n`);
run("pnpm tauri build", {
  env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.WIRI_SIGNING_PASSWORD ?? "" },
});

// 4. latest.json apuntando al instalador de esta versión.
const dir = path.join(root, "src-tauri/target/release/bundle/nsis");
const setup = `Wiri_${version}_x64-setup.exe`;
const exe = path.join(dir, setup);
if (!fs.existsSync(`${exe}.sig`)) fail(`No se generó la firma ${setup}.sig`);
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: fs.readFileSync(`${exe}.sig`, "utf8").trim(),
      url: `https://github.com/${REPO}/releases/download/${tag}/${setup}`,
    },
  },
};
const latestPath = path.join(dir, "latest.json");
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2));
console.log(`\n▸ ${path.relative(root, latestPath)} listo`);
if (dry) process.exit(0);

// 5. Etiqueta y release (la última publicada es la que lee el actualizador).
run(`git tag ${tag}`);
run(`git push origin ${tag}`);
fs.writeFileSync(path.join(dir, "notes.md"), notes);
run(`gh release create ${tag} --repo ${REPO} --title "Wiri ${version}" --notes-file "${path.join(dir, "notes.md")}" "${exe}" "${exe}.sig" "${latestPath}"`);
console.log(`\n✓ Wiri ${version} publicada: https://github.com/${REPO}/releases/tag/${tag}`);
