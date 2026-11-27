// Übernimmt den Klartext-Reiseplan (Artifact index.html) verschlüsselt in die Offline-App.
// Aufruf: CN_PW=... node tools/sync.mjs <klartext.html> [--check]
// Gleiches Salt und gleiche Iterationen wie bisher (gespeicherte Schlüssel auf den Handys bleiben gültig),
// neuer zufälliger IV. Prüft Syntax und Roundtrip, schreibt index.html, sw.js und tools/last-sync.sha256.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { webcrypto as wc, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
const checkOnly = process.argv.includes("--check");
const pw = process.env.CN_PW;
if (!src || !pw) { console.error("FEHLER: Aufruf CN_PW=... node tools/sync.mjs <klartext.html>"); process.exit(2); }

const plain = readFileSync(src, "utf8");
if (!/<html/i.test(plain) || !plain.includes("const DAYS") || plain.length < 100000) {
  console.error("FEHLER: Datei sieht nicht wie der Reiseplan aus"); process.exit(3);
}
const hash = createHash("sha256").update(plain).digest("hex");
const hashFile = join(ROOT, "tools", "last-sync.sha256");
if (existsSync(hashFile) && readFileSync(hashFile, "utf8").trim() === hash) { console.log("UNVERAENDERT"); process.exit(0); }

// Syntax aller Inline-Skripte prüfen
const tmp = mkdtempSync(join(tmpdir(), "cnsync-"));
const scripts = [...plain.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
scripts.forEach((s, k) => {
  const f = join(tmp, `s${k}.js`); writeFileSync(f, s);
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { console.error(`FEHLER: Syntaxfehler in Skript ${k}:\n` + e.stderr.toString().slice(0, 1500)); process.exit(4); }
});
if (checkOnly) { console.log(`OK Syntax (${scripts.length} Skripte), Aenderung vorhanden`); process.exit(0); }

const page = readFileSync(join(ROOT, "index.html"), "utf8");
const s = page.match(/\bs:\s*"([^"]+)"/)[1];
const n = Number(page.match(/\bn:\s*(\d+)/)[1]);
const b64 = b => Buffer.from(b).toString("base64");
const ub64 = t => new Uint8Array(Buffer.from(t, "base64"));
const base = await wc.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
const raw = await wc.subtle.deriveBits({ name: "PBKDF2", salt: ub64(s), iterations: n, hash: "SHA-256" }, base, 256);
const key = await wc.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

// Altes Passwort muss zum bisherigen Inhalt passen
try {
  await wc.subtle.decrypt({ name: "AES-GCM", iv: ub64(page.match(/\bi:\s*"([^"]+)"/)[1]) }, key, ub64(page.match(/\bd:\s*"([^"]+)"/)[1]));
} catch { console.error("FEHLER: Passwort passt nicht zur bisherigen Offline-App"); process.exit(5); }

const iv = wc.getRandomValues(new Uint8Array(12));
const ct = await wc.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
const out = page.replace(/(\bi:\s*")[^"]+(")/, `$1${b64(iv)}$2`).replace(/(\bd:\s*")[^"]+(")/, `$1${b64(ct)}$2`);
const back = new TextDecoder().decode(await wc.subtle.decrypt({ name: "AES-GCM", iv: ub64(out.match(/\bi:\s*"([^"]+)"/)[1]) }, key, ub64(out.match(/\bd:\s*"([^"]+)"/)[1])));
if (back !== plain) { console.error("FEHLER: Roundtrip stimmt nicht"); process.exit(6); }

const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
const g = t => p.find(x => x.type === t).value;
const ver = `${g("year")}${g("month")}${g("day")}${g("hour") === "24" ? "00" : g("hour")}${g("minute")}`;
const sw = readFileSync(join(ROOT, "sw.js"), "utf8").replace(/reiseplan-china-\d{12}/, `reiseplan-china-${ver}`);
writeFileSync(join(ROOT, "index.html"), out);
writeFileSync(join(ROOT, "sw.js"), sw);
writeFileSync(hashFile, hash + "\n");
console.log(`OK aktualisiert, Version ${ver}`);
