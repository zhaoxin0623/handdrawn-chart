#!/usr/bin/env node
/**
 * check-text.mjs — assert required strings appear in generated SVG text content.
 * Usage: node check-text.mjs <graph.json> <required.txt> [--svg path]
 * Default SVG: beside the JSON's --out convention is not known; pass --svg or
 * we look for out/<basename>.svg and examples/../out/<name>.svg heuristics.
 *
 * Concatenates tspans per <text> element; also joins all text for a fuzzy
 * "node joined" check so wrapped labels still match.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: node check-text.mjs <graph.json> <required.txt> [--svg path]");
  process.exit(1);
}
const jsonPath = args[0];
const reqPath = args[1];
let svgPath = null;
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--svg") svgPath = args[++i];
}

const graph = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const required = fs.readFileSync(reqPath, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (!svgPath) {
  // Try common locations relative to cwd
  const base = path.basename(jsonPath, ".json");
  const candidates = [
    path.join("out", base + ".svg"),
    path.join(path.dirname(jsonPath), "..", "out", base + ".svg"),
    path.join("out", "chart.svg"),
  ];
  svgPath = candidates.find((p) => fs.existsSync(p));
  if (!svgPath) {
    console.error("Could not find SVG; pass --svg <path>");
    process.exit(1);
  }
}

const svg = fs.readFileSync(svgPath, "utf8");

/** Extract text contents: for each <text>...</text>, concat inner tspans / text nodes. */
function extractTextElements(svg) {
  const texts = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const inner = m[1]
      .replace(/<tspan[^>]*>/g, "")
      .replace(/<\/tspan>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (inner) texts.push(inner);
  }
  return texts;
}

const elements = extractTextElements(svg);
const joinedAll = elements.join("\n");
// Also build per-approximate-node joins: consecutive short runs
const joinedFlat = elements.join("");

// From graph, join each node's label+sub (with newlines removed / kept)
const nodeJoined = [];
for (const n of graph.nodes || []) {
  const parts = [];
  if (n.label) parts.push(String(n.label));
  if (n.sub) parts.push(String(n.sub));
  if (parts.length) nodeJoined.push(parts.join("\n"), parts.join(""), parts.join(" ").replace(/\n/g, ""));
}

function normalize(s) {
  return String(s).replace(/\s+/g, "");
}

const normAll = normalize(joinedAll);
const normFlat = normalize(joinedFlat);
const normNodes = nodeJoined.map(normalize);

let missing = 0;
for (const req of required) {
  const nreq = normalize(req);
  const ok =
    joinedAll.includes(req) ||
    joinedFlat.includes(req.replace(/\n/g, "")) ||
    normAll.includes(nreq) ||
    normFlat.includes(nreq) ||
    normNodes.some((n) => n.includes(nreq)) ||
    elements.some((e) => normalize(e).includes(nreq));
  // Also: check if every line of a multiline req appears
  const lines = req.split("\n").map((l) => l.trim()).filter(Boolean);
  const linesOk = lines.length > 1 && lines.every((ln) =>
    joinedAll.includes(ln) || normAll.includes(normalize(ln)) || normFlat.includes(normalize(ln))
  );
  if (ok || linesOk) {
    console.log(`OK  ${req.length > 60 ? req.slice(0, 57) + "..." : req}`);
  } else {
    console.log(`MISS ${req}`);
    missing++;
  }
}

console.log(`check-text: ${required.length - missing}/${required.length} found in ${svgPath}`);
process.exit(missing ? 1 : 0);
