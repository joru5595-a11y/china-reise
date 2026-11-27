// Reisedaten aus der Reise-App (index.html) gezielt als JSON lesen, statt die ganze Datei zu lesen.
// Aufruf: node daten.mjs <index.html> <befehl> [argumente] [--privat]
//   tag <JJJJ-MM-TT>        Tagesplan mit Adressen, Buchungen, Hotel, Nacht X von Y, Tag N/16, To-dos, morgen
//   todos [von] [bis]        offene Aufgaben (ohne initDone) mit due im Zeitraum (Standard: heute bis +7 Tage)
//   adresse <id> [id ...]    Adresskarten inkl. Karten-Link
//   suche <text>             Treffer in Tagen, Adressen und Buchungen
//   uebersicht               alle Tage in einer Zeile
//   buchungen [JJJJ-MM-TT]   Buchungen (optional nur dieser Tag)
//   kontakte                 Notrufnummern und Kontakte
//   pruefen                  Syntax aller Skripte und Verweise prüfen (nach einer Änderung)
// --privat (an beliebiger Stelle): für Lilli und Papa. Entfernt Preise und Joel-Interna.
// Exit-Code: 0 OK, 1 Fehler (z. B. Tag oder Adresse fehlt, Prüfung fehlgeschlagen), 2 falscher Aufruf.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const ALL = process.argv.slice(2);
const privat = ALL.includes("--privat");
const [file, cmd, ...args] = ALL.filter(a => a !== "--privat");
if (!file || !cmd) { console.error("FEHLER: Aufruf node daten.mjs <index.html> <tag|todos|adresse|suche|uebersicht|buchungen|kontakte|pruefen> ... [--privat]"); process.exit(2); }
let s; try { s = readFileSync(file, "utf8"); } catch (e) { console.error(`FEHLER: Datei ${file} nicht lesbar (${e.code || e.message})`); process.exit(2); }

const NAMES = ["FLIGHTREF", "CITY", "GEO", "ADDR", "DAYS", "WALLET", "TODOS", "CONTACTS", "BRING", "INFO", "LEGS", "HOTEL_OF", "KIND"];
let D;
function grab(n) {
  const i = s.search(new RegExp("const " + n + "\\s*=")); if (i < 0) return null;
  let j = s.indexOf("=", i) + 1; while (/\s/.test(s[j])) j++;
  const open = s[j];
  if (!"[{\"'`".includes(open)) return s.slice(j, s.indexOf(";", j));
  let d = 0, k = j, str = null;
  for (; k < s.length; k++) { const c = s[k];
    if (str) { if (c === "\\") { k++; continue } if (c === str) str = null; continue }
    if (c === '"' || c === "'" || c === "`") { if (d === 0) { str = c; let m = k + 1; while (s[m] !== c || s[m - 1] === "\\") m++; return s.slice(j, m + 1); } str = c; continue }
    if ("[{(".includes(c)) d++; else if ("]})".includes(c)) { d--; if (!d) break } }
  return s.slice(j, k + 1);
}
function load() { const ctx = {}; vm.createContext(ctx);
  for (const n of NAMES) { const src = grab(n); if (src == null) continue; try { vm.runInContext(`var ${n}=(${src});`, ctx) } catch (e) { console.error("Konnte " + n + " nicht lesen: " + e.message) } }
  D = ctx; }
load();

if (cmd === "pruefen") {
  const tmp = mkdtempSync(join(tmpdir(), "cnchk-"));
  const scripts = [...s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  let ok = true;
  scripts.forEach((sc, k) => { const f = join(tmp, `s${k}.js`); writeFileSync(f, sc);
    try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { ok = false; console.log(`FEHLER Skript ${k}: ` + e.stderr.toString().split("\n").slice(0, 6).join(" | ")); } });
  // Verweise und Formate prüfen (Syntax allein findet keine kaputten IDs)
  const F = [], W = [], has = (arr, id) => (arr || []).some(x => x.id === id);
  const datum = /^\d{4}-\d{2}-\d{2}$/, zeit = /^\d{2}:\d{2}$/, ARTEN = ["go", "see", "eat", "stay", "free"];
  if (!Array.isArray(D.DAYS) || !Array.isArray(D.ADDR) || !Array.isArray(D.WALLET) || !Array.isArray(D.TODOS)) F.push("DAYS, ADDR, WALLET oder TODOS nicht lesbar");
  else {
    const dup = (arr, name) => { const seen = new Set(); arr.forEach(x => { if (seen.has(x.id)) F.push(`${name}: doppelte id ${x.id}`); seen.add(x.id); }); };
    dup(D.ADDR, "ADDR"); dup(D.WALLET, "WALLET"); dup(D.TODOS, "TODOS");
    let prev = "";
    D.DAYS.forEach(T => { const w = `Tag ${T.d}`;
      if (!datum.test(T.d || "")) F.push(`${w}: Datum ungültig`); if (T.d <= prev) F.push(`${w}: Reihenfolge oder doppelt`); prev = T.d;
      if (!D.CITY?.[T.c]) F.push(`${w}: unbekannte Stadt „${T.c}“`);
      (T.items || []).forEach((it, i) => { const [z, art, titel, , o = {}] = it, v = `${w}, Punkt ${i + 1} (${titel})`;
        if (!zeit.test(z || "")) F.push(`${v}: Uhrzeit „${z}“ ungültig`);
        if (!ARTEN.includes(art)) F.push(`${v}: art „${art}“ unbekannt`);
        if (!titel) F.push(`${v}: Titel fehlt`);
        if (o.p && !has(D.ADDR, o.p)) F.push(`${v}: Adresse ${o.p} fehlt in ADDR`);
        if (o.w && !has(D.WALLET, o.w)) F.push(`${v}: Buchung ${o.w} fehlt in WALLET`);
        if (i && z < T.items[i - 1][0]) W.push(`${v}: Uhrzeit vor dem vorherigen Punkt`); }); });
    D.WALLET.forEach(b => { const v = `Buchung ${b.id}`;
      if (!datum.test(b.d || "")) F.push(`${v}: Datum ungültig`);
      if (b.out && !datum.test(b.out)) F.push(`${v}: out ungültig`);
      if (b.time && !zeit.test(b.time)) F.push(`${v}: time „${b.time}“ ungültig`);
      for (const k of ["addr", "fromA"]) if (b[k] && !has(D.ADDR, b[k])) F.push(`${v}: ${k} ${b[k]} fehlt in ADDR`); });
    D.ADDR.forEach(a => { if (!D.CITY?.[a.city]) F.push(`Adresse ${a.id}: unbekannte Stadt „${a.city}“`); if (!a.cnn || !a.cn) F.push(`Adresse ${a.id}: chinesischer Name oder Adresse fehlt`); });
    D.TODOS.forEach(t => { if (!datum.test(t.due || "")) F.push(`Aufgabe ${t.id}: due ungültig`); if (!t.t) F.push(`Aufgabe ${t.id}: Titel fehlt`); });
  }
  if (F.length) { ok = false; console.log("FEHLER:\n- " + F.join("\n- ")); }
  if (W.length) console.log("WARNUNG:\n- " + W.join("\n- "));
  if (ok) { console.log(`OK: ${scripts.length} Skripte fehlerfrei, ${D.DAYS.length} Tage, ${D.ADDR.length} Adressen, ${D.WALLET.length} Buchungen, ${D.TODOS.length} Aufgaben`); }
  process.exit(ok ? 0 : 1);
}

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const dt = x => new Date(x + "T12:00:00Z");
const add = (x, n) => { const d = dt(x); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const kurz = x => `${WT[dt(x).getUTCDay()]} ${x.slice(8, 10)}.${x.slice(5, 7)}.`;
const heute = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const PREIS = /(\d[\d.,]*\s?-?\s?(€|¥|EUR|CNY|RMB|USD|\$))|((€|¥|EUR|CNY|RMB|USD|\$)\s?\d[\d.,]*)|Amex|Platin|Gold \d|FHR|Priority Pass|Guthaben|Rechnung|Anzahlung|Kreditkarte|Zahlung|zurückzahlen|Kostenaufteilung/i;
const ABK = t => t.replace(/\b([pz])\. ([PB])\./g, "$1.\u00a0$2.").replace(/\b(ca|Ca|inkl|bzw|max|Min|Std|Nr|evtl|u|d|vs|Tel)\. /g, "$1.\u00a0");
const INTERN = /\bToms?\b|Joel Noah Ruhland|Joel zahlt|für Joel|nur Joel|Mitgliedsnummer|Platinum|GHA|Bonvoy|Hilton Honors/i;
const neutral = t => t.replace(/\s*\((Hilton|GHA|Marriott|Bonvoy|Amex|FHR)[^)]*\)/g, "").replace(/über Tom vom Hotel/g, "über den Hotel-Concierge").replace(/\bTom \(Concierge ([^)]+)\)/g, "Concierge $1").replace(/\(z\. ?B\. Tom\)\s*/g, "");
const clean = t => { if (!privat || !t) return t;
  const teile = ABK(neutral(String(t))).replace(/\b(\d{1,2}\.\d{1,2}\.(\d{2,4})?) (?=[a-zäöüß0-9])/g, "$1\u00a0").split(/((?<=[.;!?]) +|\n+| +· +)/);
  const out = []; for (let i = 0; i < teile.length; i += 2) { const satz = teile[i], sep = teile[i + 1] || "";
    if (satz && !PREIS.test(satz) && !INTERN.test(satz)) out.push(satz + sep); }
  return out.join("").replace(/\s*·\s*$/, "").replace(/\u00a0/g, " ").trim() || undefined; };
function karte(a) {
  const ccn = D.CITY[a.city]?.cn || "";
  const q = (a.cat === "hotel" || (ccn && a.cnn.includes(ccn))) ? a.cnn : `${ccn} ${a.cnn}`.trim();
  const g = D.GEO[a.city]; const sll = g ? `&sll=${g[0].toFixed(2)},${g[1].toFixed(2)}` : "";
  return `https://maps.apple.com/?q=${encodeURIComponent(q)}${sll}&z=15`;
}
function adr(id) { const a = D.ADDR.find(x => x.id === id); if (!a) return { id, fehlt: true };
  return { id, label: a.de.replace(/\s*[–—]\s*/g, ": "), cnn: a.cnn, cn: a.cn, en: a.en, stadt: a.city, hotel: a.cat === "hotel", karte: karte(a) }; }
function buchung(w) { const o = { ...w }; delete o.ref; if (privat) { o.note = clean(o.note); o.sub = clean(o.sub); o.t = neutral(o.t || ""); delete o.st; }
  if (w.addr) o.adresse = adr(w.addr); if (w.fromA) o.vonAdresse = adr(w.fromA); return o; }
function hotelNacht(d) {
  const h = D.WALLET.find(w => w.type === "hotel" && w.d <= d && d < w.out); if (!h) return null;
  const n = Math.round((dt(h.out) - dt(h.d)) / 864e5), x = Math.round((dt(d) - dt(h.d)) / 864e5) + 1;
  return { hotel: h.t, nacht: `Nacht ${x} von ${n}`, checkout: h.out, adresse: h.addr ? adr(h.addr) : null };
}
function tagNr(d) { const n = Math.round((dt(d) - dt("2026-12-20")) / 864e5) + 1; return n >= 1 && n <= 16 ? `${n}/16` : null; }
function todos(von, bis) { return D.TODOS.filter(t => !t.initDone && t.due >= von && t.due <= bis).sort((a, b) => a.due.localeCompare(b.due))
  .map(t => ({ due: t.due, tag: kurz(t.due), titel: t.t, info: clean(t.b) })); }
function tag(d) {
  const T = D.DAYS.find(x => x.d === d); if (!T) return { fehler: `Kein Tag ${d} in der App` };
  const ids = new Set(), items = T.items.map(([zeit, art, titel, info, o = {}]) => { if (o.p) ids.add(o.p);
    return { zeit, art, titel: privat ? neutral(titel).replace(/\s*\(?\d[\d.,]*\s?(¥|€)\)?/g, "") : titel, info: clean(info) || undefined, optional: o.opt || undefined, wennEng: clean(o.skip) || undefined, adresse: o.p || undefined, buchung: o.w || undefined, dauerMin: o.dur || undefined }; });
  const hn = hotelNacht(d); if (hn?.adresse) ids.add(hn.adresse.id);
  D.WALLET.filter(w => w.type === "hotel" && w.out === d && w.addr).forEach(w => ids.add(w.addr));
  const morgenT = D.DAYS.find(x => x.d === add(d, 1));
  return {
    datum: d, kurz: kurz(d), tagNr: tagNr(d), stadt: T.c, stadtName: D.CITY[T.c]?.n, stadtCn: D.CITY[T.c]?.cn, ort: T.place, titel: T.title, unterkunft: T.stay,
    hotel: hn, treffpunkt: T.meet || null, ablauf: items,
    buchungen: D.WALLET.filter(w => w.d === d || w.out === d).map(buchung),
    adressen: [...ids].map(adr), todosHeuteMorgen: privat ? undefined : todos(d, add(d, 1)),
    checkoutHeute: D.WALLET.filter(w => w.type === "hotel" && w.out === d).map(w => ({ hotel: w.t, adresse: w.addr ? adr(w.addr) : null })),
    morgen: morgenT ? { datum: morgenT.d, kurz: kurz(morgenT.d), stadt: morgenT.c, titel: morgenT.title, erste: morgenT.items.slice(0, 3).map(i => `${i[0]} ${i[2]}`).filter(x => !privat || !PREIS.test(x)), buchungen: D.WALLET.filter(w => w.d === morgenT.d || w.out === morgenT.d).map(w => `${w.time || ""} ${w.no || ""} ${w.t}`.trim()) } : null,
    kontakte: D.CONTACTS,
  };
}

let out;
switch (cmd) {
  case "tag": { const d = args[0] || heute(); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { console.error(`FEHLER: Datum „${d}“ bitte als JJJJ-MM-TT`); process.exit(2); }
    out = tag(d); if (out.fehler) { console.log(JSON.stringify(out)); process.exit(1); } break; }
  case "todos": { if (privat) { out = []; break; } const v = args[0] || heute(); out = todos(v, args[1] || add(v, 7)); break; }
  case "adresse": out = args.map(adr); if (!args.length || out.some(a => a.fehlt)) { console.log(JSON.stringify(out)); process.exit(1); } break;
  case "suche": { const q = args.join(" ").toLowerCase(); const hit = o => JSON.stringify(o).toLowerCase().includes(q);
    out = { tage: D.DAYS.flatMap(d => d.items.filter(hit).map(i => ({ datum: d.d, zeit: i[0], titel: i[2] }))), adressen: D.ADDR.filter(hit).map(a => adr(a.id)), buchungen: D.WALLET.filter(hit).map(w => ({ id: w.id, t: w.t, d: w.d })),
    todos: privat ? [] : D.TODOS.filter(hit).map(t => ({ id: t.id, due: t.due, titel: t.t, erledigt: !!t.initDone })),
    tagTitel: D.DAYS.filter(d => [d.title, d.place, d.stay].join(" ").toLowerCase().includes(q)).map(d => ({ datum: d.d, titel: d.title })) }; break; }
  case "uebersicht": out = D.DAYS.map(d => `${d.d} ${kurz(d.d)} ${d.c} ${d.title}`); break;
  case "buchungen": out = D.WALLET.filter(w => !args[0] || w.d === args[0] || w.out === args[0]).map(buchung); break;
  case "kontakte": out = D.CONTACTS; break;
  default: console.error("FEHLER: Unbekannter Befehl " + cmd); process.exit(2);
}
// Gedankenstriche aus den App-Texten mailtauglich machen (Schreibregel): Bereiche „5–6“ → „5 bis 6“, sonst Komma bzw. Doppelpunkt
const TITEL = new Set(["t", "titel", "label", "title"]);
const strich = (k, v) => v.replace(/(\d)\s?[–—]\s?(\d)/g, "$1 bis $2").replace(/\s+[–—]\s+/g, TITEL.has(k) ? ": " : ", ").replace(/[–—]/g, "-");
console.log(JSON.stringify(out, (k, v) => v === undefined ? undefined : typeof v === "string" && !/^https?:/.test(v) ? strich(k, v) : v));
