#!/usr/bin/env node
/**
 * draw.mjs — generic hand-drawn statechart/diagram renderer (Node built-ins only).
 * Usage: node draw.mjs <graph.json> --out <dir> [--name chart] [--allow-overlap]
 */
import fs from "node:fs";
import path from "node:path";

// ─── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes("--self-test-wrap")) {
  // wrapText/tw defined below; self-test runs after their definitions via deferred call
  globalThis.__DRAW_SELF_TEST_WRAP__ = true;
}
if (!globalThis.__DRAW_SELF_TEST_WRAP__ && (args.length < 1 || args[0] === "-h" || args[0] === "--help")) {
  console.error("Usage: node draw.mjs <graph.json> --out <dir> [--name chart] [--allow-overlap]");
  console.error("       node draw.mjs --self-test-wrap");
  process.exit(args[0] ? 0 : 1);
}
const jsonPath = globalThis.__DRAW_SELF_TEST_WRAP__ ? null : args[0];
let outDir = "out", chartName = "chart", allowOverlap = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--out") outDir = args[++i];
  else if (args[i] === "--name") chartName = args[++i];
  else if (args[i] === "--allow-overlap") allowOverlap = true;
}

const graph = globalThis.__DRAW_SELF_TEST_WRAP__
  ? { seed: 1, title: {}, nodes: [], edges: [] }
  : JSON.parse(fs.readFileSync(jsonPath, "utf8"));

// ─── Style constants ─────────────────────────────────────────────────────────
const INK = "#2f2a26";
const RED = "#b8352f";
const BUG = "#d22b22";
const GREEN = "#2f8a4c";
const PAPER = "#f4eee0";
const TICKET = "#fbf6ea";
const MUTED = "#9a8b7a";
const SERIF = `'Songti SC','STSong','Noto Serif CJK SC',serif`;
const TYPE = `'American Typewriter','Courier New','STFangsong','FangSong','Noto Sans Mono CJK SC',monospace`;

const PAD = 48;
const LEFT_GUTTER = 200; // room for illustrations + notes
const TITLE_H = 240;
const GROUP_GAP = 72;
const RANK_GAP_COL = 64; // vertical gap between ranks in column layout
const RANK_GAP_ROW = 80; // horizontal gap between ranks in row layout
const NODE_GAP = 36;
const SIDEBAR_W = 320;
const SIDEBAR_GAP = 40;
const GROUP_PAD = 40;
const MAX_LABEL_W = 300;
const CARD_FS = 22;
const SUB_FS = 14;

// ─── PRNG ────────────────────────────────────────────────────────────────────
let seed = Number.isFinite(graph.seed) ? (graph.seed >>> 0) : 20261101;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const j = (a) => (rnd() - 0.5) * 2 * a;

// ─── SVG helpers ─────────────────────────────────────────────────────────────
const out = [];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tw = (s, fs) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? fs : fs * 0.6), 0);

function wobble(pts, amp = 1.4) {
  const r = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 40));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      r.push([x1 + (x2 - x1) * t + j(amp), y1 + (y2 - y1) * t + j(amp)]);
    }
  }
  r.push(pts[pts.length - 1]);
  return r;
}
const pathD = (p) => "M" + p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");

function pencil(pts, { color = INK, w = 2, dash = "", passes = 2, fill = "none", amp = 1.4 } = {}) {
  for (let i = 0; i < passes; i++) {
    out.push(
      `<path d="${pathD(wobble(pts, amp))}" fill="${i ? "none" : fill}" stroke="${color}" stroke-width="${i ? w * 0.6 : w}" stroke-opacity="${i ? 0.55 : 0.95}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`
    );
  }
}

/** Track text/card boxes for overlap check */
const boxes = []; // {kind:'text'|'card'|'edge-label', id, x0,y0,x1,y1, label?}
const routedEdges = []; // {from,to,label,style,pts}
const chromeRects = []; // {id, kind:'sidebar'|'legend', x0,y0,x1,y1}
function trackBox(kind, id, x0, y0, x1, y1, label) {
  boxes.push({ kind, id, x0, y0, x1, y1, label: label || id });
}

function text(s, x, y, opts = {}) {
  const {
    size = 22, font = TYPE, color = INK, anchor = "middle", weight = 400,
    italic = false, track = true, trackId = null, trackPad = 2,
  } = opts;
  out.push(
    `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}"${italic ? ' font-style="italic"' : ""}>${esc(s)}</text>`
  );
  if (track) {
    const w = tw(s, size);
    let x0, x1;
    if (anchor === "start") { x0 = x; x1 = x + w; }
    else if (anchor === "end") { x0 = x - w; x1 = x; }
    else { x0 = x - w / 2; x1 = x + w / 2; }
    trackBox("text", trackId || `t:${s.slice(0, 24)}`, x0 - trackPad, y - size + trackPad, x1 + trackPad, y + trackPad, s);
  }
}

function textLines(lines, x, y0, lineH, opts = {}) {
  lines.forEach((l, i) => text(l, x, y0 + i * lineH, opts));
}

// ─── Text wrap ───────────────────────────────────────────────────────────────
/** Closing punctuation that must not start a line (CJK kinsoku + ASCII). */
const KINSOKU_LINE_START = new Set([
  ..."）)」』】〉》〗〕］｝。，、；：！？.,;:!?%)".split(""),
]);

/** ASCII letter/digit/identifier run — never break inside. */
function isLatinRunChar(ch) {
  if (ch.codePointAt(0) > 127) return false;
  return /[A-Za-z0-9_./+\-]/.test(ch);
}

function tokenizeForWrap(para) {
  const chars = [...para];
  const atoms = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      atoms.push({ type: "space", text: ch });
      i++;
      continue;
    }
    if (isLatinRunChar(ch)) {
      let j = i + 1;
      while (j < chars.length && isLatinRunChar(chars[j])) j++;
      atoms.push({ type: "word", text: chars.slice(i, j).join("") });
      i = j;
      continue;
    }
    atoms.push({ type: "char", text: ch });
    i++;
  }
  return atoms;
}

function applyKinsoku(lines, maxW, fs) {
  const outLines = lines.slice();
  for (let i = 1; i < outLines.length; i++) {
    let guard = 0;
    while (outLines[i] && guard++ < 32) {
      const chars = [...outLines[i]];
      const head = chars[0];
      if (!KINSOKU_LINE_START.has(head)) break;
      const rest = chars.slice(1).join("");
      const keepOnPrev = outLines[i - 1] + head;
      // Prefer keeping punct on previous line when it still fits (or no width budget)
      if (maxW == null || tw(keepOnPrev, fs) <= maxW || ![...outLines[i - 1]].length) {
        outLines[i - 1] = keepOnPrev;
        outLines[i] = rest;
        continue;
      }
      // Otherwise pull previous char down with the punct
      const prevChars = [...outLines[i - 1]];
      if (prevChars.length <= 1) {
        // nowhere to pull from — keep on prev even if slightly over
        outLines[i - 1] = keepOnPrev;
        outLines[i] = rest;
        break;
      }
      const last = prevChars.pop();
      outLines[i - 1] = prevChars.join("");
      outLines[i] = last + head + rest;
      // re-check new head (may still be kinsoku if last was also punct — rare)
    }
  }
  return outLines.filter((l, idx) => l.length > 0 || (idx === 0 && outLines.length === 1));
}

function wrapText(str, maxW, fs) {
  const raw = String(str).split("\n");
  const lines = [];
  for (const para of raw) {
    if (!para) { lines.push(""); continue; }
    const atoms = tokenizeForWrap(para);
    let cur = "";
    const paraLines = [];
    for (const atom of atoms) {
      if (atom.type === "space" && !cur) continue; // no leading space on a new line
      const trial = cur + atom.text;
      if (tw(trial, fs) > maxW && cur) {
        paraLines.push(cur);
        cur = atom.type === "space" ? "" : atom.text; // word may exceed maxW alone — keep intact
      } else {
        cur = trial;
      }
    }
    if (cur) paraLines.push(cur);
    lines.push(...(paraLines.length ? applyKinsoku(paraLines, maxW, fs) : [""]));
  }
  return lines.length ? lines : [""];
}

function runWrapSelfTest() {
  const fs_ = 20;
  let failed = 0;
  const check = (name, ok, detail) => {
    if (ok) console.log(`OK  ${name}`);
    else { console.log(`FAIL ${name}: ${detail}`); failed++; }
  };
  // Never break inside "pass"
  for (const w of [40, 50, 60, 80, 120]) {
    const lines = wrapText("prefix pass suffix", w, fs_);
    const joined = lines.join("|");
    const broken = lines.some((l) => /pas$/.test(l) || /^s\b/.test(l) || l === "pas" || l === "s");
    const hasPass = lines.some((l) => l.includes("pass")) || joined.replace(/\|/g, "").includes("pass");
    check(`latin-pass@${w}`, hasPass && !broken, joined);
  }
  // case_rule stays intact
  {
    const lines = wrapText("每次都 pass（case_rule）", 100, fs_);
    const flat = lines.join("");
    check("case_rule-intact", flat.includes("case_rule") && !lines.some((l) => /^rule/.test(l)), lines.join("|"));
  }
  // Closing punct never starts a line
  {
    const samples = [
      "代码整洁度（模型评分·只记录）",
      "只记录不参与)",
      "0.62 ≥ 0.8 ✗ fail)",
      "（第一个是基线）",
      "hello.",
      "done!",
      "rate ≥ 80%",
    ];
    for (const sample of samples) {
      for (const w of [60, 80, 100, 140, 180]) {
        const lines = wrapText(sample, w, fs_);
        const bad = lines.slice(1).filter((l) => l && KINSOKU_LINE_START.has([...l][0]));
        check(`kinsoku:${sample.slice(0, 12)}@${w}`, bad.length === 0, lines.join("|"));
      }
    }
  }
  // Hard newline still honored
  {
    const lines = wrapText("一行\n二行", 400, fs_);
    check("hard-newline", lines.length === 2 && lines[0] === "一行" && lines[1] === "二行", lines.join("|"));
  }
  if (failed) {
    console.error(`wrap self-test: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("wrap self-test: all passed");
}

if (globalThis.__DRAW_SELF_TEST_WRAP__) {
  runWrapSelfTest();
  process.exit(0);
}

// ─── Color helpers ───────────────────────────────────────────────────────────
function resolveNodeColors(node) {
  const kind = node.kind || "normal";
  if (node.color) {
    return {
      fill: tint(node.color, 0.85),
      edge: node.color,
      text: darken(node.color, 0.35),
      pin: node.color,
    };
  }
  if (kind === "bug") return { fill: "#f9d9d3", edge: BUG, text: "#9e1d17", pin: BUG };
  if (kind === "fix") return { fill: "#dcefdc", edge: GREEN, text: "#1d6236", pin: GREEN };
  return { fill: TICKET, edge: INK, text: INK, pin: "#c9a227" };
}

function tint(hex, t) {
  // mix hex toward white by t (0=hex, 1=white) — simple
  const n = parseInt(String(hex).replace("#", ""), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const R = Math.round(r + (255 - r) * t);
  const G = Math.round(g + (255 - g) * t);
  const B = Math.round(b + (255 - b) * t);
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}
function darken(hex, t) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const R = Math.round(r * (1 - t)), G = Math.round(g * (1 - t)), B = Math.round(b * (1 - t));
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}

// ─── Measure nodes ───────────────────────────────────────────────────────────
function measureNode(node) {
  const kind = node.kind || "normal";
  if (kind === "start") return { w: 30, h: 30, lines: [], subLines: [] };
  if (kind === "decision") {
    const raw = (node.label && node.label !== "？") ? node.label : "";
    if (!raw) return { w: 72, h: 72, lines: ["？"], subLines: [] };
    const dlines = wrapText(raw, node.maxWidth || 260, 18);
    const lw = Math.max(60, ...dlines.map((l) => tw(l, 18)));
    // Layout box ≈ diamond; label draws under into the rank gap
    return { w: Math.max(72, lw), h: 72 + 8 + dlines.length * 22, lines: dlines, subLines: [] };
  }

  const fs = kind === "chip" ? 18 : CARD_FS;
  const maxW = node.maxWidth || MAX_LABEL_W;
  const lines = wrapText(node.label || "", maxW, fs);
  const subLines = node.sub ? wrapText(node.sub, maxW, SUB_FS) : [];
  const labelW = Math.max(...lines.map((l) => tw(l, fs)), 40);
  const subW = subLines.length ? Math.max(...subLines.map((l) => tw(l, SUB_FS))) : 0;
  const contentW = Math.max(labelW, subW);
  const padX = kind === "chip" ? 28 : 56;
  const w = Math.min(Math.max(contentW + padX, 100), maxW + padX);
  const h =
    (kind === "chip" ? 22 : 34) +
    lines.length * (fs + 8) +
    (subLines.length ? 8 + subLines.length * (SUB_FS + 4) : 0) +
    8;
  return { w, h, lines, subLines, fs };
}

// ─── Layout ──────────────────────────────────────────────────────────────────
const nodes = (graph.nodes || []).map((n) => ({ ...n }));
const edges = (graph.edges || []).map((e) => ({ ...e }));
const groups = (graph.groups || []).map((g) => ({ ...g, layout: g.layout || "column" }));
const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));

// Pre-measure
for (const n of nodes) {
  const m = measureNode(n);
  n._m = m;
  n.w = m.w;
  n.h = m.h;
}

/** Longest-path ranks within a set of node ids, using only edges whose both ends are in the set. */
function rankNodes(ids) {
  const set = new Set(ids);
  const preds = Object.fromEntries(ids.map((id) => [id, []]));
  const succs = Object.fromEntries(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (set.has(e.from) && set.has(e.to) && e.from !== e.to) {
      succs[e.from].push(e.to);
      preds[e.to].push(e.from);
    }
  }
  // Kahn + longest path from sources
  const rank = Object.fromEntries(ids.map((id) => [id, 0]));
  const indeg = Object.fromEntries(ids.map((id) => [id, preds[id].length]));
  const q = ids.filter((id) => indeg[id] === 0);
  const order = [];
  while (q.length) {
    const u = q.shift();
    order.push(u);
    for (const v of succs[u]) {
      rank[v] = Math.max(rank[v], rank[u] + 1);
      if (--indeg[v] === 0) q.push(v);
    }
  }
  // leftover cycles → assign after max
  for (const id of ids) if (!order.includes(id)) {
    rank[id] = Math.max(0, ...preds[id].map((p) => rank[p] + 1), 0);
    order.push(id);
  }
  const maxR = Math.max(0, ...Object.values(rank));
  const ranks = Array.from({ length: maxR + 1 }, () => []);
  for (const id of ids) ranks[rank[id]].push(id);
  // stable: keep JSON order within a rank
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  for (const r of ranks) r.sort((a, b) => idx[a] - idx[b]);
  return ranks;
}

function layoutGroupNodes(g, x0, y0, innerW) {
  const ids = nodes.filter((n) => n.group === g.id && n.kind !== "start").map((n) => n.id);
  if (!ids.length) return { w: innerW, h: GROUP_PAD * 2 };

  const ranks = rankNodes(ids);
  const isCol = g.layout !== "row";
  let cursor = isCol ? y0 + GROUP_PAD + 12 : x0 + GROUP_PAD;
  const placed = [];

  if (isCol) {
    // ranks top→bottom; within rank, nodes left→right centered
    let maxW = 0;
    const rankInfos = ranks.map((idsInRank) => {
      const ws = idsInRank.map((id) => nodeById[id].w);
      const hs = idsInRank.map((id) => nodeById[id].h);
      const totalW = ws.reduce((a, b) => a + b, 0) + NODE_GAP * Math.max(0, idsInRank.length - 1);
      const maxH = Math.max(...hs, 40);
      maxW = Math.max(maxW, totalW);
      return { idsInRank, totalW, maxH };
    });
    const contentW = Math.max(maxW, innerW - GROUP_PAD * 2);
    for (const { idsInRank, totalW, maxH } of rankInfos) {
      let x = x0 + GROUP_PAD + (contentW - totalW) / 2 + /* center of first */ 0;
      // recompute starting x so the row is centered in the group inner area
      const innerLeft = x0 + GROUP_PAD;
      x = innerLeft + (Math.max(contentW, innerW - GROUP_PAD * 2) - totalW) / 2;
      for (const id of idsInRank) {
        const n = nodeById[id];
        n.x = x + n.w / 2;
        n.y = cursor + maxH / 2;
        n.x0 = n.x - n.w / 2;
        n.y0 = n.y - n.h / 2;
        n.x1 = n.x + n.w / 2;
        n.y1 = n.y + n.h / 2;
        placed.push(id);
        x += n.w + NODE_GAP;
      }
      cursor += maxH + RANK_GAP_COL;
    }
    const h = cursor - y0 - RANK_GAP_COL + GROUP_PAD;
    const w = Math.max(innerW, maxW + GROUP_PAD * 2);
    // re-center if group wider
    return { w, h, placed };
  } else {
    // ranks left→right; within rank, nodes top→bottom centered
    let maxH = 0;
    const rankInfos = ranks.map((idsInRank) => {
      const hs = idsInRank.map((id) => nodeById[id].h);
      const ws = idsInRank.map((id) => nodeById[id].w);
      const totalH = hs.reduce((a, b) => a + b, 0) + NODE_GAP * Math.max(0, idsInRank.length - 1);
      const maxW = Math.max(...ws, 40);
      maxH = Math.max(maxH, totalH);
      return { idsInRank, totalH, maxW };
    });
    for (const { idsInRank, totalH, maxW } of rankInfos) {
      let y = y0 + GROUP_PAD + 12 + (maxH - totalH) / 2;
      for (const id of idsInRank) {
        const n = nodeById[id];
        n.x = cursor + maxW / 2;
        n.y = y + n.h / 2;
        n.x0 = n.x - n.w / 2;
        n.y0 = n.y - n.h / 2;
        n.x1 = n.x + n.w / 2;
        n.y1 = n.y + n.h / 2;
        placed.push(id);
        y += n.h + NODE_GAP;
      }
      cursor += maxW + RANK_GAP_ROW;
    }
    const w = cursor - x0 - RANK_GAP_ROW + GROUP_PAD;
    const h = Math.max(maxH + GROUP_PAD * 2 + 12, 80);
    return { w, h, placed };
  }
}

// Main canvas width estimate
const hasSidebar = !!(graph.sidebar && graph.sidebar.panels && graph.sidebar.panels.length);
const mainW = graph.width || 1200;
const canvasW = LEFT_GUTTER + mainW + (hasSidebar ? SIDEBAR_W + SIDEBAR_GAP : 0) + PAD * 2;

// Place title / legend reservation
let yCursor = TITLE_H;
const groupBoxes = {}; // id -> {x0,y0,x1,y1,pin,label}

// Place groups stacked vertically in the main column
const mainLeft = PAD + LEFT_GUTTER;
const mainRight = mainLeft + mainW;

for (const g of groups) {
  const availW = mainW;
  // First pass: layout with availW to get needed size
  const probe = layoutGroupNodes(g, mainLeft, yCursor, availW);
  // Use at least availW; if content wider, expand (rare)
  const gw = Math.max(availW * 0.55, Math.min(availW, probe.w));
  // Center group in main column
  const gx0 = mainLeft + (availW - Math.max(probe.w, gw * 0.7)) / 2;
  // Re-layout at final position with proper width
  // Clear positions and redo
  for (const n of nodes) if (n.group === g.id) { delete n.x; }
  const laid = layoutGroupNodes(g, mainLeft, yCursor, availW);
  const x0 = mainLeft;
  const y0 = yCursor;
  const x1 = mainLeft + availW;
  const y1 = yCursor + laid.h;
  groupBoxes[g.id] = { x0, y0, x1, y1, pin: g.color || "#c9a227", label: g.label, color: g.color };
  yCursor = y1 + GROUP_GAP;
}

// Place ungrouped non-start nodes in gaps based on edges
const ungrouped = nodes.filter((n) => !n.group && n.kind !== "start" && n.x == null);
for (const n of ungrouped) {
  // Find predecessor / successor groups
  const predEdges = edges.filter((e) => e.to === n.id);
  const succEdges = edges.filter((e) => e.from === n.id);
  const predNodes = predEdges.map((e) => nodeById[e.from]).filter(Boolean);
  const succNodes = succEdges.map((e) => nodeById[e.to]).filter(Boolean);
  let y;
  if (predNodes.length && predNodes.every((p) => p.y1 != null)) {
    y = Math.max(...predNodes.map((p) => p.y1)) + 50 + n.h / 2;
  } else if (succNodes.length && succNodes.every((s) => s.y0 != null)) {
    y = Math.min(...succNodes.map((s) => s.y0)) - 50 - n.h / 2;
  } else {
    y = yCursor + n.h / 2;
    yCursor += n.h + GROUP_GAP;
  }
  // x: average of connected nodes, or center
  const connected = [...predNodes, ...succNodes].filter((c) => c.x != null);
  const x = connected.length ? connected.reduce((s, c) => s + c.x, 0) / connected.length : (mainLeft + mainRight) / 2;
  n.x = x;
  n.y = y;
  n.x0 = x - n.w / 2;
  n.y0 = y - n.h / 2;
  n.x1 = x + n.w / 2;
  n.y1 = y + n.h / 2;
}

// Start nodes: place above their successor
for (const n of nodes.filter((n) => n.kind === "start")) {
  const succ = edges.find((e) => e.from === n.id);
  const t = succ ? nodeById[succ.to] : null;
  n.x = t && t.x != null ? t.x : (mainLeft + mainRight) / 2;
  n.y = t && t.y0 != null ? t.y0 - 40 : TITLE_H - 20;
  n.x0 = n.x - 15; n.y0 = n.y - 15; n.x1 = n.x + 15; n.y1 = n.y + 15;
}

// If decision / ungrouped pushed past groups, ensure canvas grows
let contentBottom = yCursor;
for (const n of nodes) if (n.y1 != null) contentBottom = Math.max(contentBottom, n.y1 + 40);
for (const g of Object.values(groupBoxes)) contentBottom = Math.max(contentBottom, g.y1 + 20);

// Expand group boxes that contain nodes whose y spilled (safety)
for (const g of groups) {
  const gb = groupBoxes[g.id];
  const members = nodes.filter((n) => n.group === g.id && n.y1 != null);
  if (!members.length) continue;
  gb.y0 = Math.min(gb.y0, ...members.map((n) => n.y0 - 24));
  gb.y1 = Math.max(gb.y1, ...members.map((n) => n.y1 + 24));
  gb.x0 = Math.min(gb.x0, ...members.map((n) => n.x0 - 28));
  gb.x1 = Math.max(gb.x1, ...members.map((n) => n.x1 + 28));
  // clamp to main column with pad
  gb.x0 = Math.max(mainLeft - 8, gb.x0);
  gb.x1 = Math.min(mainRight + 8, Math.max(gb.x1, gb.x0 + 100));
}

// Sidebar layout
const sidebarCards = [];
if (hasSidebar) {
  const sx = mainRight + SIDEBAR_GAP;
  let sy = TITLE_H;
  const sb = graph.sidebar;
  sidebarCards.push({ type: "title", x: sx, y: sy, title: sb.title || "侧栏" });
  sy += 48;
  for (const pan of sb.panels) {
    const lines = [];
    if (pan.title) lines.push({ text: pan.title, weight: 700, size: 18 });
    for (const ln of pan.lines || []) lines.push({ text: ln, weight: 400, size: 15 });
    const maxLineW = Math.max(120, ...lines.map((l) => tw(l.text, l.size)));
    const cardW = Math.min(SIDEBAR_W - 8, maxLineW + 36);
    const cardH = 28 + lines.length * 24 + 12;
    sidebarCards.push({ type: "card", x: sx + cardW / 2, y: sy + cardH / 2, w: cardW, h: cardH, lines, pin: "#c9a227" });
    sy += cardH + 22;
  }
  contentBottom = Math.max(contentBottom, sy + 20);
}

const footerH = graph.footer ? 48 : 16;
const canvasH = Math.ceil(contentBottom + footerH + PAD);


function segIntersectsRect(x1, y1, x2, y2, r) {
  const inside = (x, y) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  function crosses(ax, ay, bx, by, cx, cy, dx, dy) {
    const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(den) < 1e-9) return false;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  const { x0, y0, x1: rx1, y1: ry1 } = r;
  return (
    crosses(x1, y1, x2, y2, x0, y0, rx1, y0) ||
    crosses(x1, y1, x2, y2, rx1, y0, rx1, ry1) ||
    crosses(x1, y1, x2, y2, rx1, ry1, x0, ry1) ||
    crosses(x1, y1, x2, y2, x0, ry1, x0, y0)
  );
}

const PORT_STRIP = 10; // source/target body excludes this strip at the attach side

// ─── Edge routing ────────────────────────────────────────────────────────────
function port(n, side, dx = 0, dy = 0) {
  if (!n) return [0, 0];
  // Attach at card border midpoints (on the border, not inset)
  if (side === "top") return [n.x + dx, n.y0];
  if (side === "bot") return [n.x + dx, n.y1];
  if (side === "left") return [n.x0, n.y + dy];
  if (side === "right") return [n.x1, n.y + dy];
  return [n.x, n.y];
}

/** Tight obstacle rect for routing/self-check (diamond = rhombus box only). */
function nodeObstacleRect(n) {
  if (!n || n.x0 == null) return null;
  if ((n.kind || "normal") === "decision") {
    const s = 30;
    return { id: n.id, x0: n.x - s, y0: n.y - s, x1: n.x + s, y1: n.y + s, kind: "decision" };
  }
  if ((n.kind || "normal") === "start") {
    return { id: n.id, x0: n.x - 15, y0: n.y - 15, x1: n.x + 15, y1: n.y + 15, kind: "start" };
  }
  return { id: n.id, x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1, kind: n.kind || "normal" };
}

function routingObstacles(excludeIds = []) {
  const ex = new Set(excludeIds);
  const obs = [];
  for (const n of nodes) {
    if (ex.has(n.id)) continue;
    const r = nodeObstacleRect(n);
    if (r) obs.push(r);
  }
  // Handwritten notes already tracked as cards
  for (const b of boxes) {
    if (b.kind === "card" && String(b.id).startsWith("note-")) {
      obs.push({ id: b.id, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, kind: "note" });
    }
  }
  // Sidebar / legend are never valid routing space
  if (hasSidebar) {
    obs.push({
      id: "sidebar-zone",
      x0: mainRight + 8,
      y0: TITLE_H - 40,
      x1: canvasW - 4,
      y1: canvasH - 4,
      kind: "sidebar",
    });
  }
  // Legend sits in the title band on the right of the main column
  const legX0 = Math.max(mainLeft + 40, mainRight - 420);
  obs.push({
    id: "legend-zone",
    x0: legX0 - 4,
    y0: 40,
    x1: Math.min(mainRight + 8, legX0 + 404),
    y1: 50 + 48 + ((graph.legend || []).length || 1) * 38 + 8,
    kind: "legend",
  });
  return obs;
}

function segHitsAny(x1, y1, x2, y2, obs, pad = 2) {
  for (const o of obs) {
    const r = { x0: o.x0 - pad, y0: o.y0 - pad, x1: o.x1 + pad, y1: o.y1 + pad };
    if (segIntersectsRect(x1, y1, x2, y2, r)) return o;
  }
  return null;
}

function polyHitsAny(pts, obs, pad = 2) {
  for (let i = 0; i < pts.length - 1; i++) {
    const hit = segHitsAny(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], obs, pad);
    if (hit) return hit;
  }
  return null;
}

function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

function dedupPts(pts) {
  const clean = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i], [px, py] = clean[clean.length - 1];
    if (Math.hypot(x - px, y - py) > 1.5) clean.push(pts[i]);
  }
  return clean;
}

function routeEdge(e) {
  const a = nodeById[e.from], b = nodeById[e.to];
  if (!a || !b || a.x == null || b.x == null) return null;

  // Choose attach sides: prefer vertical when target is clearly below/above
  let fromSide, toSide;
  if (b.y0 >= a.y1 - 4) { fromSide = "bot"; toSide = "top"; }
  else if (a.y0 >= b.y1 - 4) { fromSide = "top"; toSide = "bot"; }
  else if (b.x > a.x + 8) { fromSide = "right"; toSide = "left"; }
  else if (b.x < a.x - 8) { fromSide = "left"; toSide = "right"; }
  else { fromSide = "bot"; toSide = "top"; }

  // Fan-out on border midpoints so multi-edges don't stack
  const outIdx = edges.filter((x) => x.from === e.from).indexOf(e);
  const outN = edges.filter((x) => x.from === e.from).length;
  const inIdx = edges.filter((x) => x.to === e.to).indexOf(e);
  const inN = edges.filter((x) => x.to === e.to).length;
  const fanOut = outN > 1 ? (outIdx - (outN - 1) / 2) * 16 : 0;
  const fanIn = inN > 1 ? (inIdx - (inN - 1) / 2) * 16 : 0;

  const p0 = (fromSide === "bot" || fromSide === "top") ? port(a, fromSide, fanOut) : port(a, fromSide, 0, fanOut);
  const p1 = (toSide === "bot" || toSide === "top") ? port(b, toSide, fanIn) : port(b, toSide, 0, fanIn);

  const obs = routingObstacles([e.from, e.to]);
  // Also treat source/target BODIES as soft obstacles for intermediate segments
  // (ports themselves sit on the border). Use shrunk rects excluding port strips.
  const soft = [];
  for (const n of [a, b]) {
    const r = nodeObstacleRect(n);
    if (!r) continue;
    const shrink = { ...r };
    const inset = 3;
    shrink.x0 += inset; shrink.y0 += inset; shrink.x1 -= inset; shrink.y1 -= inset;
    if (n === a) {
      if (fromSide === "bot") shrink.y1 -= PORT_STRIP;
      else if (fromSide === "top") shrink.y0 += PORT_STRIP;
      else if (fromSide === "left") shrink.x0 += PORT_STRIP;
      else shrink.x1 -= PORT_STRIP;
    } else {
      if (toSide === "bot") shrink.y1 -= PORT_STRIP;
      else if (toSide === "top") shrink.y0 += PORT_STRIP;
      else if (toSide === "left") shrink.x0 += PORT_STRIP;
      else shrink.x1 -= PORT_STRIP;
    }
    if (shrink.x1 > shrink.x0 && shrink.y1 > shrink.y0) soft.push(shrink);
  }
  const allObs = obs.concat(soft);

  // Clamp helper: keep waypoints in the main column (never sidebar)
  const clampX = (x) => Math.max(mainLeft + 6, Math.min(x, mainRight - 6));
  const clampY = (y) => Math.max(TITLE_H - 30, Math.min(y, canvasH - 20));

  const candidates = [];

  // A. Direct only when nearly axis-aligned
  if (Math.abs(p0[0] - p1[0]) < 8 || Math.abs(p0[1] - p1[1]) < 8) {
    candidates.push([p0, p1]);
  }

  // B. Single elbow (orthographic)
  candidates.push([p0, [p0[0], p1[1]], p1]);
  candidates.push([p0, [p1[0], p0[1]], p1]);

  // C. Mid-gap horizontal then vertical (between stacked nodes)
  const midY = (p0[1] + p1[1]) / 2;
  candidates.push([p0, [p0[0], midY], [p1[0], midY], p1]);

  // D. Local side jogs around obstacles — try several x corridors in the main column
  const leftBound = mainLeft + 20;
  const rightBound = mainRight - 20;
  const xs = new Set();
  // near source/target
  xs.add(clampX(p0[0]));
  xs.add(clampX(p1[0]));
  // just outside each obstacle
  for (const o of obs) {
    if (o.kind === "sidebar" || o.kind === "legend") continue;
    xs.add(clampX(o.x0 - 18));
    xs.add(clampX(o.x1 + 18));
  }
  // a few evenly spaced corridors
  for (let k = 0; k < 5; k++) xs.add(clampX(leftBound + ((rightBound - leftBound) * k) / 4));

  for (const x of xs) {
    // down / across / down
    candidates.push([p0, [p0[0], midY], [x, midY], [x, p1[1]], p1]);
    candidates.push([p0, [x, p0[1]], [x, p1[1]], p1]);
    // exit sideways first then vertical
    const drop = fromSide === "bot" ? Math.min(p0[1] + 24, midY) : Math.max(p0[1] - 24, midY);
    candidates.push([p0, [p0[0], drop], [x, drop], [x, p1[1]], p1]);
  }

  // Between groups: prefer the gap channel
  const ga = a.group ? groupBoxes[a.group] : null;
  const gb = b.group ? groupBoxes[b.group] : null;
  if (ga && gb && gb.y0 > ga.y1 + 2) {
    const gapY = (ga.y1 + gb.y0) / 2;
    candidates.push([p0, [p0[0], gapY], [p1[0], gapY], p1]);
    for (const x of xs) {
      candidates.push([p0, [p0[0], gapY], [x, gapY], [p1[0], gapY], p1]);
    }
  }

  // Score candidates
  let best = null;
  let bestScore = Infinity;
  const directLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  for (const raw of candidates) {
    // clamp intermediate x to main column
    const pts = raw.map((pt, i) => {
      if (i === 0 || i === raw.length - 1) return pt;
      return [clampX(pt[0]), clampY(pt[1])];
    });
    const clean = dedupPts(pts);
    if (clean.length < 2) continue;
    const hit = polyHitsAny(clean, allObs, 4); // pad so we don't skim card corners
    const L = polyLength(clean);
    let diag = 0;
    for (let i = 1; i < clean.length; i++) {
      const dx = Math.abs(clean[i][0] - clean[i - 1][0]);
      const dy = Math.abs(clean[i][1] - clean[i - 1][1]);
      if (dx > 8 && dy > 8) diag += Math.hypot(dx, dy);
    }
    // Penalize hits heavily; prefer ortho; penalize long detours vs direct
    const score = (hit ? 1e6 : 0) + L + diag * 3 + Math.max(0, L - directLen * 1.8) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = clean;
    }
  }

  if (!best) return dedupPts([p0, [p0[0], p1[1]], p1]);
  // If even the best still hits, try a last-resort wide bypass inside the main column
  if (bestScore >= 1e6) {
    const bypassXs = [mainLeft + 30, mainRight - 30, (mainLeft + mainRight) / 2];
    for (const x of bypassXs) {
      const pts = dedupPts([p0, [clampX(p0[0]), p0[1]], [clampX(x), p0[1]], [clampX(x), p1[1]], p1]);
      const hit = polyHitsAny(pts, allObs, 4);
      const L = polyLength(pts);
      const score = (hit ? 1e6 : 0) + L + 50;
      if (score < bestScore) { bestScore = score; best = pts; }
    }
  }
  return best;
}

function edgeStyle(style) {
  if (style === "bug") return { color: BUG, w: 4.2 };
  if (style === "fix") return { color: GREEN, w: 3 };
  if (style === "muted") return { color: MUTED, w: 2 };
  return { color: RED, w: 2.4 };
}

/** Bounding box of a would-be edge label at (x,y) (top-left of first baseline area). */
function edgeLabelBox(x, y, lw, lh, size) {
  const pad = 6;
  return {
    x0: x - pad,
    y0: y - size - pad + 4,
    x1: x + lw + pad,
    y1: y - size - pad + 4 + lh + pad,
  };
}

function inflateBox(b, m) {
  return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
}

function boxesTouch(a, b) {
  return !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
}

/** Min gap between box edges (0 if overlapping; negative if deep overlap). */
function boxGap(a, b) {
  const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
  const dy = Math.max(a.y0 - b.y1, b.y0 - a.y1, 0);
  if (dx === 0 && dy === 0) {
    // overlapping: negative penetration
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return -Math.min(ox, oy);
  }
  return Math.hypot(dx, dy);
}

const EDGE_LABEL_CLEAR = 12; // required clearance vs nodes/notes/other edge labels

function occupiedTargets(extraIgnoreIds = []) {
  const ignore = new Set(extraIgnoreIds);
  const out = [];
  for (const b of boxes) {
    if (ignore.has(b.id)) continue;
    if (/^(kicker|title|subtitle|footer:|legend:|leg:|sidebar:|sb:|g:)/.test(b.id)) continue;
    // skip individual text lines that belong to a tracked card/edge-label (card covers them)
    if (b.kind === "text" && (boxes.some((c) => c.kind === "card" && (b.id === c.id || b.id.startsWith(c.id + ":"))) ||
        boxes.some((c) => c.kind === "edge-label" && b.id.startsWith(c.id + ":")))) continue;
    out.push(b);
  }
  return out;
}

function boxHitsOccupied(box, extraIgnoreIds = [], clear = EDGE_LABEL_CLEAR) {
  const inflated = inflateBox(box, clear);
  let hits = 0;
  for (const b of occupiedTargets(extraIgnoreIds)) {
    if (boxesTouch(inflated, b)) hits++;
  }
  // Endpoint cards (ignored for clearance) still cannot contain the label
  for (const id of extraIgnoreIds) {
    const b = boxes.find((x) => x.kind === "card" && x.id === id);
    if (b && boxesTouch(box, b)) hits += 3;
  }
  return hits;
}

function nearestGap(box, extraIgnoreIds = []) {
  let best = Infinity;
  for (const b of occupiedTargets(extraIgnoreIds)) {
    best = Math.min(best, boxGap(box, b));
  }
  return best;
}

// Try many positions along the polyline; pick the least-colliding offset.
function placeEdgeLabel(pts, label, edgeKey = "e", ignoreIds = []) {
  if (!label || pts.length < 2) return null;
  const size = 17;
  const lineH = size + 4;
  const lines = wrapText(label, 180, size);
  const lw = Math.max(...lines.map((l) => tw(l, size)));
  const lh = lines.length * lineH;
  const candidates = [];
  const ts = [0.18, 0.3, 0.4, 0.5, 0.6, 0.7, 0.82];
  const offsets = [14, 22, 32, 44, 58, 74, 92, 110, 130, -14, -22, -32, -44, -58, -74, -92, -110, -130];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    if (len < 12) continue;
    const nx = -dy / len, ny = dx / len;
    for (const t of ts) {
      const mx = x1 + dx * t, my = y1 + dy * t;
      for (const off of offsets) {
        // Anchor so (x,y) is first baseline start (matching drawEdgeLabel)
        let ox, oy;
        if (Math.abs(dx) < 4) {
          ox = mx + (off >= 0 ? Math.abs(off) : -Math.abs(off) - lw);
          oy = my - lh / 2 + size;
        } else if (Math.abs(dy) < 4) {
          ox = mx - lw / 2;
          oy = my + (off >= 0 ? -Math.abs(off) : Math.abs(off) + size);
        } else {
          ox = mx + nx * off - lw / 2;
          oy = my + ny * off;
        }
        ox = Math.max(8, Math.min(ox, canvasW - lw - 8));
        oy = Math.max(size + 8, Math.min(oy, canvasH - 8));
        const box = edgeLabelBox(ox, oy, lw, lh, size);
        if (box.x0 < 0 || box.y0 < 0 || box.x1 > canvasW || box.y1 > canvasH) continue;
        const hits = boxHitsOccupied(box, ignoreIds);
        const gap = nearestGap(box, ignoreIds);
        // Prefer zero hits, then larger gap, then smaller |off|, mid-segment, longer segment
        const score = hits * 10000 + Math.max(0, EDGE_LABEL_CLEAR - gap) * 80 + Math.abs(off) * 0.4 + Math.abs(t - 0.5) * 12 - len * 0.01 - Math.min(gap, 80) * 0.3;
        candidates.push({ x: ox, y: oy, lines, lw, lh, size, hits, gap, score, box, edgeKey });
      }
    }
  }
  // Parking spots: far left/right of polyline bbox (helps short edges)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const midY = (minY + maxY) / 2;
  const midX = (minX + maxX) / 2;
  const parks = [
    [maxX + 20, midY - lh / 2 + size],
    [minX - lw - 20, midY - lh / 2 + size],
    [midX - lw / 2, minY - lh - 16],
    [midX - lw / 2, maxY + size + 16],
    [maxX + 40, midY - lh / 2 + size],
    [minX - lw - 40, midY - lh / 2 + size],
    [maxX + 64, midY - lh / 2 + size],
    [minX - lw - 64, midY - lh / 2 + size],
    [maxX + 90, midY - lh / 2 + size],
    [minX - lw - 90, midY - lh / 2 + size],
    [maxX + 120, midY - lh / 2 + size],
    [minX - lw - 120, midY - lh / 2 + size],
  ];
  for (const [px, py] of parks) {
    const ox = Math.max(8, Math.min(px, canvasW - lw - 8));
    const oy = Math.max(size + 8, Math.min(py, canvasH - 8));
    const box = edgeLabelBox(ox, oy, lw, lh, size);
    if (box.x0 < 0 || box.y0 < 0 || box.x1 > canvasW || box.y1 > canvasH) continue;
    const hits = boxHitsOccupied(box, ignoreIds);
    const gap = nearestGap(box, ignoreIds);
    const score = hits * 10000 + Math.max(0, EDGE_LABEL_CLEAR - gap) * 80 + 30 - Math.min(gap, 80) * 0.3;
    candidates.push({ x: ox, y: oy, lines, lw, lh, size, hits, gap, score, box, edgeKey });
  }

  if (!candidates.length) {
    // fallback midpoint
    const mid = pts[Math.floor(pts.length / 2)];
    const x = Math.max(8, Math.min(mid[0], canvasW - lw - 8));
    const y = Math.max(size + 8, mid[1]);
    return { x, y, lines, lw, lh, size, edgeKey, box: edgeLabelBox(x, y, lw, lh, size) };
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0];
}

// ─── Draw illustrations ──────────────────────────────────────────────────────
function drawPerson(x, y, shirt) {
  out.push(`<circle cx="${x}" cy="${y}" r="26" fill="#fbe9d8" stroke="${INK}" stroke-width="2.4"/>`);
  out.push(`<path d="M${x - 26},${y - 6} Q${x},${y - 44} ${x + 26},${y - 6} Q${x},${y - 22} ${x - 26},${y - 6}Z" fill="${INK}"/>`);
  out.push(`<circle cx="${x - 9}" cy="${y + 2}" r="2.6" fill="${INK}"/><circle cx="${x + 9}" cy="${y + 2}" r="2.6" fill="${INK}"/><circle cx="${x - 16}" cy="${y + 11}" r="5" fill="#f2a0a8" fill-opacity="0.7"/><circle cx="${x + 16}" cy="${y + 11}" r="5" fill="#f2a0a8" fill-opacity="0.7"/>`);
  pencil([[x - 30, y + 30], [x + 30, y + 30], [x + 34, y + 100], [x - 34, y + 100], [x - 30, y + 30]], { color: INK, w: 2.2, fill: shirt, passes: 1 });
}

function drawProgrammer(x, y) {
  drawPerson(x, y, "#9cc7e4");
  pencil([[x - 70, y + 112], [x + 90, y + 112]], { w: 3, passes: 1 });
  pencil([[x - 40, y + 106], [x + 50, y + 106], [x + 66, y + 60], [x - 24, y + 60], [x - 40, y + 106]], { w: 2, fill: "#d9d4cc", passes: 1 });
  pencil([[x + 30, y + 60], [x + 40, y + 40]], { w: 2, passes: 1 });
  pencil([[x - 76, y + 150], [x - 14, y + 150], [x - 14, y + 184], [x - 76, y + 184], [x - 76, y + 150]], { w: 2, fill: TICKET, passes: 1 });
  text("Ctrl", x - 45, y + 174, { size: 18, weight: 700, track: false });
  pencil([[x - 2, y + 150], [x + 40, y + 150], [x + 40, y + 184], [x - 2, y + 184], [x - 2, y + 150]], { w: 2, fill: TICKET, passes: 1 });
  text("C", x + 19, y + 174, { size: 18, weight: 700, track: false });
  text("啪！", x + 60, y + 172, { size: 24, font: SERIF, weight: 700, color: BUG, anchor: "start", track: false });
}

function drawScorer(x, y, caption) {
  drawPerson(x, y, "#c9b6e8");
  pencil([[x + 20, y + 40], [x + 68, y + 40], [x + 68, y + 102], [x + 20, y + 102], [x + 20, y + 40]], { w: 2, fill: TICKET, passes: 1 });
  pencil([[x + 28, y + 56], [x + 34, y + 64], [x + 48, y + 48]], { color: GREEN, w: 2.4, passes: 1 });
  pencil([[x + 28, y + 84], [x + 48, y + 84]], { w: 1.4, passes: 1 });
  pencil([[x + 28, y + 92], [x + 60, y + 92]], { w: 1.4, passes: 1 });
  if (caption) text(caption, x, y + 140, { size: 20, font: SERIF, weight: 700, track: false });
}

function illustrationAnchor(ill) {
  if (ill.near && groupBoxes[ill.near]) {
    const g = groupBoxes[ill.near];
    if (ill.side === "right") return [Math.min(g.x1 + 70, canvasW - 80), (g.y0 + g.y1) / 2];
    // left / default → sit in gutter
    return [Math.max(70, Math.min(g.x0 - 90, LEFT_GUTTER / 2 + PAD)), (g.y0 + g.y1) / 2];
  }
  if (ill.near && nodeById[ill.near] && nodeById[ill.near].x != null) {
    const n = nodeById[ill.near];
    return [Math.max(70, n.x0 - 80), n.y];
  }
  if (ill.x != null) return [ill.x, ill.y || 400];
  return [Math.max(70, LEFT_GUTTER / 2), 700];
}

// ─── Draw tickets / nodes ────────────────────────────────────────────────────
let ticketNo = 0;
function drawTicket(n) {
  const kind = n.kind || "normal";
  if (kind === "start") {
    out.push(`<circle cx="${n.x}" cy="${n.y}" r="15" fill="none" stroke="${INK}" stroke-width="2"/><circle cx="${n.x}" cy="${n.y}" r="9" fill="${RED}"/>`);
    trackBox("card", n.id, n.x - 15, n.y - 15, n.x + 15, n.y + 15, "start");
    return;
  }
  if (kind === "decision") {
    const cx = n.x, cy = n.y, s = 30;
    const cols = resolveNodeColors(n);
    pencil([[cx, cy - s], [cx + s, cy], [cx, cy + s], [cx - s, cy], [cx, cy - s]], { color: cols.edge || INK, w: 2.4, fill: cols.fill || TICKET, amp: 0.6 });
    text("？", cx, cy + 9, { size: 26, font: SERIF, weight: 700, trackId: n.id + ":?" });
    // Label under the diamond (obstacle rect for edges stays diamond-only via nodeObstacleRect)
    const raw = (n.label && n.label !== "？") ? n.label : "";
    if (raw) {
      const dlines = wrapText(raw, n.maxWidth || 260, 18);
      dlines.forEach((l, i) => text(l, cx, cy + s + 22 + i * 22, { size: 18, font: SERIF, weight: 700, color: cols.text, trackId: `${n.id}:L${i}` }));
      const lw = Math.max(...dlines.map((l) => tw(l, 18)), s * 2);
      // Geometry used for ports: diamond only (keep attach points on the rhombus)
      n.x0 = cx - s; n.y0 = cy - s; n.x1 = cx + s; n.y1 = cy + s;
      // Track a larger card for label overlap checks (not used as routing obstacle)
      trackBox("card", n.id, cx - lw / 2 - 8, cy - s - 8, cx + lw / 2 + 8, cy + s + 22 + (dlines.length - 1) * 22 + 10, raw);
    } else {
      n.x0 = cx - s; n.y0 = cy - s; n.x1 = cx + s; n.y1 = cy + s;
      trackBox("card", n.id, cx - s - 8, cy - s - 8, cx + s + 8, cy + s + 8, "decision");
    }
    return;
  }

  const cols = resolveNodeColors(n);
  // Override pin from group color if normal and no explicit color
  let pin = cols.pin;
  if (!n.color && kind === "normal" && n.group && groupBoxes[n.group]) pin = groupBoxes[n.group].pin;

  const { lines, subLines, fs } = n._m;
  const w = n.w, h = n.h;
  const x0 = n.x0, y0 = n.y0, x1 = n.x1, y1 = n.y1;
  const edge = cols.edge;
  const thick = kind === "bug" || kind === "fix" ? 3.6 : kind === "chip" ? 1.6 : 2;

  // shadow
  out.push(`<path d="${pathD([[x0 + 5, y0 + 6], [x1 + 5, y0 + 6], [x1 + 5, y1 + 6], [x0 + 5, y1 + 6]])}Z" fill="${INK}" fill-opacity="0.10"/>`);

  // zigzag bottom
  const teeth = [];
  const nTeeth = Math.max(4, Math.round(w / 14));
  for (let k = 0; k <= nTeeth; k++) teeth.push([x1 - (w * k) / nTeeth, y1 + (k % 2 ? 5 : -2)]);
  pencil([[x0, y0], [x1, y0], ...teeth, [x0, y0]], { color: edge, w: thick, fill: cols.fill, amp: 0.9 });

  if (kind === "bug" || kind === "fix") {
    pencil([[x0 - 7, y0 - 7], [x1 + 7, y0 - 7], [x1 + 7, y1 + 9], [x0 - 7, y1 + 9], [x0 - 7, y0 - 7]], { color: edge, w: 2.2, passes: 1, amp: 2 });
  }

  // red rule + No.
  pencil([[x0 + 10, y0 + 14], [x1 - 10, y0 + 14]], { color: RED, w: 0.8, passes: 1, amp: 0.4 });
  const no = String(++ticketNo).padStart(2, "0");
  text(`No. ${no}`, x0 + 12, y0 + 11, { size: 10, anchor: "start", color: RED, track: false });

  // pin
  out.push(`<circle cx="${n.x}" cy="${y0}" r="8" fill="${pin}" stroke="${INK}" stroke-width="1.5"/><circle cx="${n.x - 2.5}" cy="${y0 - 2.5}" r="2.4" fill="#fff" fill-opacity="0.6"/>`);

  // labels
  const textColor = cols.text;
  lines.forEach((l, i) => text(l, n.x, y0 + 46 + i * (fs + 8), { size: fs, font: SERIF, weight: 700, color: textColor, trackId: `${n.id}:L${i}` }));
  const subTop = y0 + 46 + lines.length * (fs + 8) + 4;
  subLines.forEach((l, i) => text(l, n.x, subTop + i * (SUB_FS + 4), { size: SUB_FS, font: TYPE, color: textColor, trackId: `${n.id}:S${i}` }));

  trackBox("card", n.id, x0 - 4, y0 - 10, x1 + 4, y1 + 8, n.label);
}

function drawGroupBox(g) {
  const b = groupBoxes[g.id];
  if (!b) return;
  pencil([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [b.x0, b.y0]], { color: "#7a6a58", w: 2, dash: "14 10", passes: 1, amp: 1.6 });
  const lw = tw(g.label, 26) + 24;
  out.push(`<rect x="${b.x0 + 18}" y="${b.y0 - 18}" width="${lw}" height="36" fill="${PAPER}"/>`);
  out.push(`<circle cx="${b.x0 + 18}" cy="${b.y0}" r="7" fill="${b.pin}" stroke="${INK}" stroke-width="1.2"/>`);
  text(g.label, b.x0 + 32, b.y0 + 9, { size: 26, font: SERIF, weight: 700, anchor: "start", trackId: `g:${g.id}` });
}

function drawArrowStroke(pts, style) {
  if (!pts || pts.length < 2) return;
  const { color, w } = edgeStyle(style);
  pencil(pts, { color, w, passes: 2, amp: 1.1 });
}
function drawArrowHead(pts, style) {
  if (!pts || pts.length < 2) return;
  const { color, w } = edgeStyle(style);
  const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1];
  const a = Math.atan2(by - ay, bx - ax), L = 16;
  pencil(
    [[bx - L * Math.cos(a - 0.4), by - L * Math.sin(a - 0.4)], [bx, by], [bx - L * Math.cos(a + 0.4), by - L * Math.sin(a + 0.4)]],
    { color, w: w * 1.1, passes: 1, amp: 0.6 }
  );
}
function drawArrow(pts, style) {
  drawArrowStroke(pts, style);
  drawArrowHead(pts, style);
}

function drawEdgeLabel(info) {
  if (!info) return;
  const { x, y, lines, lw, lh } = info;
  const size = info.size || 18;
  const lineH = size + 4;
  const pad = 6;
  const key = info.edgeKey || "e";
  const box = info.box || edgeLabelBox(x, y, lw, lh, size);
  out.push(`<rect x="${box.x0.toFixed(1)}" y="${box.y0.toFixed(1)}" width="${(box.x1 - box.x0).toFixed(1)}" height="${(box.y1 - box.y0).toFixed(1)}" fill="${PAPER}" fill-opacity="0.92"/>`);
  lines.forEach((l, i) => text(l, x, y + i * lineH, { size, anchor: "start", italic: true, trackId: `el-${key}:${i}` }));
  trackBox("edge-label", `el-${key}`, box.x0, box.y0, box.x1, box.y1, lines.join(" "));
}

function drawNote(note) {
  const lines = wrapText(note.text, 180, 15);
  const lw = Math.max(...lines.map((l) => tw(l, 15)));
  const lh = lines.length * 20 + 16;
  let x, y;
  if (note.group && groupBoxes[note.group]) {
    const g = groupBoxes[note.group];
    if (note.side === "right") x = Math.min(g.x1 + 16, canvasW - lw - 28);
    else x = Math.max(10, g.x0 - lw - 24);
    y = g.y0 + 36;
  } else if (note.near && nodeById[note.near] && nodeById[note.near].x != null) {
    const n = nodeById[note.near];
    // For decisions, keep notes clear of the under-label
    const extra = (n.kind === "decision") ? 36 : 0;
    if (note.side === "left") x = Math.max(10, n.x0 - lw - 20 - extra);
    else x = Math.min(n.x1 + 24 + extra, canvasW - lw - 28);
    y = Math.max(TITLE_H, n.y - lh / 2);
  } else if (note.x != null) {
    x = note.x; y = note.y;
  } else {
    x = PAD; y = TITLE_H;
  }
  // final clamp
  x = Math.max(8, Math.min(x, canvasW - lw - 28));
  const x0 = x, y0 = y, x1 = x + lw + 20, y1 = y + lh;
  out.push(`<rect x="${x0 + 3}" y="${y0 + 3}" width="${lw + 20}" height="${lh}" fill="${INK}" fill-opacity="0.08"/>`);
  pencil([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], { color: "#7a6a58", w: 1.4, fill: "#f7f0dc", passes: 1, amp: 1.2 });
  const noteId = `note-${(note.near || note.group || "x")}-${String(note.text).slice(0, 12)}`;
  lines.forEach((l, i) => text(l, x0 + 10, y0 + 20 + i * 20, { size: 15, anchor: "start", italic: true, weight: 700, trackId: `${noteId}:${i}` }));
  trackBox("card", noteId, x0, y0, x1, y1, note.text);
}

function drawLegend() {
  const items = graph.legend || [];
  if (!items.length) return;
  const lx0 = Math.max(mainLeft + 40, mainRight - 420);
  const ly0 = 50;
  let h = 48 + items.length * 38;
  const lx1 = lx0 + 400, ly1 = ly0 + h;
  pencil([[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1], [lx0, ly0]], { color: "#7a6a58", w: 2, dash: "10 8", passes: 1 });
  const legendTitle = graph.legendTitle || "Legend";
  text(legendTitle, lx0 + 20, ly0 + 36, { size: 24, font: SERIF, weight: 700, anchor: "start", trackId: "legend:title" });
  let yy = ly0 + 64;
  for (const it of items) {
    const kind = it.kind || "swatch";
    const col = it.color || (kind === "bug" ? BUG : kind === "fix" ? GREEN : RED);
    if (kind === "line" || it.swatch === "line") {
      pencil([[lx0 + 20, yy], [lx0 + 56, yy]], { color: col, w: 4.4, passes: 1 });
    } else if (kind === "decision" || it.swatch === "decision") {
      const cx = lx0 + 38, cy = yy;
      pencil([[cx, cy - 10], [cx + 10, cy], [cx, cy + 10], [cx - 10, cy], [cx, cy - 10]], { color: INK, w: 1.6, passes: 1 });
    } else {
      const fill = kind === "bug" || it.swatch === "bug" ? "#f9d9d3" : kind === "fix" || it.swatch === "fix" ? "#dcefdc" : tint(col, 0.85);
      const edge = kind === "bug" || it.swatch === "bug" ? BUG : kind === "fix" || it.swatch === "fix" ? GREEN : col;
      pencil([[lx0 + 20, yy - 10], [lx0 + 56, yy - 10], [lx0 + 56, yy + 12], [lx0 + 20, yy + 12], [lx0 + 20, yy - 10]], { color: edge, w: 3, fill, passes: 1 });
    }
    text(it.text, lx0 + 70, yy + 6, { size: 19, anchor: "start", trackId: `leg:${it.text.slice(0, 20)}` });
    yy += 38;
  }
  chromeRects.push({ id: "legend", kind: "legend", x0: lx0, y0: ly0, x1: lx1, y1: ly1 });
}

function drawSidebar() {
  let sbUnion = null;
  for (const c of sidebarCards) {
    if (c.type === "title") {
      text(c.title, c.x, c.y, { size: 26, font: SERIF, weight: 700, anchor: "start", trackId: "sidebar:title" });
      continue;
    }
    const x0 = c.x - c.w / 2, y0 = c.y - c.h / 2, x1 = c.x + c.w / 2, y1 = c.y + c.h / 2;
    sbUnion = sbUnion
      ? { x0: Math.min(sbUnion.x0, x0 - 8), y0: Math.min(sbUnion.y0, y0 - 8), x1: Math.max(sbUnion.x1, x1 + 8), y1: Math.max(sbUnion.y1, y1 + 8) }
      : { x0: x0 - 8, y0: y0 - 8, x1: x1 + 8, y1: y1 + 8 };
    out.push(`<path d="${pathD([[x0 + 4, y0 + 5], [x1 + 4, y0 + 5], [x1 + 4, y1 + 5], [x0 + 4, y1 + 5]])}Z" fill="${INK}" fill-opacity="0.08"/>`);
    const teeth = [];
    const nTeeth = Math.max(3, Math.round(c.w / 14));
    for (let k = 0; k <= nTeeth; k++) teeth.push([x1 - (c.w * k) / nTeeth, y1 + (k % 2 ? 4 : -2)]);
    pencil([[x0, y0], [x1, y0], ...teeth, [x0, y0]], { color: INK, w: 1.8, fill: TICKET, amp: 0.8 });
    out.push(`<circle cx="${c.x}" cy="${y0}" r="6" fill="${c.pin}" stroke="${INK}" stroke-width="1.2"/>`);
    c.lines.forEach((l, i) => {
      text(l.text, x0 + 14, y0 + 28 + i * 24, {
        size: l.size, font: i === 0 ? SERIF : TYPE, weight: l.weight, anchor: "start",
        trackId: `sb:${l.text.slice(0, 18)}`,
      });
    });
    trackBox("card", `sidebar:${c.lines[0]?.text || "?"}`, x0, y0 - 6, x1, y1 + 6, c.lines[0]?.text);
  }
  if (sbUnion) chromeRects.push({ id: "sidebar", kind: "sidebar", ...sbUnion });
}

function drawStamp(nearId, lines) {
  const n = nodeById[nearId];
  if (!n || n.x == null) return;
  const sx = n.x1 + 90, sy = n.y;
  out.push(`<g transform="rotate(-10 ${sx} ${sy})">`);
  const lw = Math.max(...lines.map((l) => tw(l, 20))) + 24;
  const lh = lines.length * 26 + 20;
  pencil([[sx - lw / 2, sy - lh / 2], [sx + lw / 2, sy - lh / 2], [sx + lw / 2, sy + lh / 2], [sx - lw / 2, sy + lh / 2], [sx - lw / 2, sy - lh / 2]], { color: BUG, w: 3, passes: 1 });
  lines.forEach((l, i) => text(l, sx, sy - lh / 2 + 28 + i * 26, { size: i === 0 ? 22 : 18, font: SERIF, weight: 700, color: BUG, track: false }));
  out.push(`</g>`);
}

// ─── Compose SVG ─────────────────────────────────────────────────────────────
// Background paper + grain
out.push(`<rect x="0" width="${canvasW}" height="${canvasH}" fill="${PAPER}"/>`);
for (let i = 0; i < Math.min(800, Math.round(canvasW * canvasH / 4000)); i++) {
  out.push(`<circle cx="${(rnd() * canvasW).toFixed(0)}" cy="${(rnd() * canvasH).toFixed(0)}" r="${(rnd() * 1.3 + 0.3).toFixed(1)}" fill="#8a7458" fill-opacity="${(rnd() * 0.12 + 0.03).toFixed(2)}"/>`);
}

// Title block
const T = graph.title || {};
if (T.kicker) text(T.kicker, PAD + 22, 70, { size: 22, anchor: "start", trackId: "kicker" });
if (T.title) text(T.title, PAD + 16, 160, { size: 84, font: SERIF, anchor: "start", weight: 400, trackId: "title" });
if (T.subtitle) text(T.subtitle, PAD + 22, 210, { size: 28, anchor: "start", italic: true, trackId: "subtitle" });

drawLegend();

// Groups then nodes
for (const g of groups) drawGroupBox(g);

// Notes first so edge labels can dodge them (and so cards cover notes? notes are aside)
for (const note of graph.notes || []) drawNote(note);

// Route + draw edge STROKES under tickets so card faces are never painted over by lines
const edgeDraw = [];
for (const e of edges) {
  const pts = routeEdge(e);
  if (!pts) {
    console.warn(`WARN edge ${e.from}->${e.to} could not route`);
    continue;
  }
  routedEdges.push({ from: e.from, to: e.to, label: e.label || "", style: e.style || "normal", pts });
  drawArrowStroke(pts, e.style || "normal");
  edgeDraw.push({ pts, style: e.style || "normal", label: e.label || "", from: e.from, to: e.to });
}

for (const n of nodes) {
  if (n.x == null) {
    console.warn(`WARN node ${n.id} has no position`);
    continue;
  }
  drawTicket(n);
}

// Arrowheads + edge labels above tickets (heads sit at border ports)
for (const ed of edgeDraw) {
  drawArrowHead(ed.pts, ed.style);
  if (ed.label) {
    const key = `${ed.from}-${ed.to}`;
    const info = placeEdgeLabel(ed.pts, ed.label, key, [ed.from, ed.to]);
    drawEdgeLabel(info);
  }
}

// Stamps (optional convenience)
for (const st of graph.stamps || []) drawStamp(st.near, st.lines || []);

// Illustrations (caption optional; scorer/person)
for (const ill of graph.illustrations || []) {
  const [ix, iy] = illustrationAnchor(ill);
  if (ill.kind === "programmer") drawProgrammer(ix, iy);
  else if (ill.kind === "scorer") drawScorer(ix, iy, ill.caption);
  else {
    drawPerson(ix, iy, ill.shirt || "#9cc7e4");
    if (ill.caption) text(ill.caption, ix, iy + 140, { size: 20, font: SERIF, weight: 700, track: false });
  }
}

drawSidebar();

// Footer
if (graph.footer) {
  const flines = wrapText(graph.footer, canvasW - PAD * 2, 15);
  flines.forEach((l, i) => text(l, PAD + 22, canvasH - 28 - (flines.length - 1 - i) * 18, { size: 15, anchor: "start", color: "#6b5d4f", trackId: `footer:${i}` }));
}

// ─── Overlap check ───────────────────────────────────────────────────────────
function overlap(a, b, clear = 0) {
  return boxesTouch(inflateBox(a, clear), b);
}
let warnCount = 0;
const texts = boxes.filter((b) => b.kind === "text");
const cards = boxes.filter((b) => b.kind === "card");

function textGroup(id) {
  // sibling lines share the prefix before the last ":N"
  const m = String(id).match(/^(.*):\d+$/);
  return m ? m[1] : id;
}
const isChrome = (id) => /^(leg:|legend:|kicker|title|subtitle|footer:|sidebar:|sb:|g:)/.test(id);
const edgeLabels = boxes.filter((b) => b.kind === "edge-label");
const EL_CLEAR = EDGE_LABEL_CLEAR;

for (let i = 0; i < texts.length; i++) {
  for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (textGroup(a.id) === textGroup(b.id)) continue;
    if (isChrome(a.id) || isChrome(b.id)) continue;
    if (String(a.id).startsWith("el-") || String(b.id).startsWith("el-")) continue;
    if (overlap(a, b)) {
      console.warn(`WARN text-overlap: "${a.label}" × "${b.label}"`);
      warnCount++;
    }
  }
}
for (const t of texts) {
  for (const c of cards) {
    if (t.id === c.id || t.id.startsWith(c.id + ":") || textGroup(t.id) === c.id) continue;
    if (isChrome(t.id)) continue;
    // note text vs its own note card
    if (c.id.startsWith("note-") && t.id.startsWith(c.id)) continue;
    // edge-label glyph boxes are covered by the edge-label × card check
    if (String(t.id).startsWith("el-")) continue;
    if (overlap(t, c)) {
      console.warn(`WARN text-card-overlap: "${t.label}" × card[${c.id}]`);
      warnCount++;
    }
  }
  for (const el of edgeLabels) {
    if (t.id.startsWith(el.id + ":") || textGroup(t.id) === el.id) continue;
    if (isChrome(t.id)) continue;
    if (String(t.id).startsWith("el-")) continue; // other edge-label lines handled by edgelabel-overlap
    // Node label text vs edge label: use clearance, but allow endpoint node of that edge at clear=0
    const elKey = String(el.id).slice(3);
    const tNode = textGroup(t.id);
    const isEndpointText = elKey === tNode || elKey.startsWith(tNode + "-") || elKey.endsWith("-" + tNode) || elKey.includes("-" + tNode + "-");
    const clear = isEndpointText ? 0 : EL_CLEAR;
    if (overlap(t, el, clear)) {
      console.warn(`WARN text-edgelabel-overlap: "${t.label}" × edge[${el.label}]`);
      warnCount++;
    }
  }
  if (t.x0 < 0 || t.y0 < 0 || t.x1 > canvasW || t.y1 > canvasH) {
    console.warn(`WARN text-oob: "${t.label}" bounds (${t.x0.toFixed(0)},${t.y0.toFixed(0)})-(${t.x1.toFixed(0)},${t.y1.toFixed(0)}) canvas ${canvasW}x${canvasH}`);
    warnCount++;
  }
}
for (const el of edgeLabels) {
  for (const c of cards) {
    const elKey = String(el.id).slice(3); // strip el-
    const isEndpoint = elKey === `${c.id}` || elKey.startsWith(c.id + "-") || elKey.endsWith("-" + c.id) || elKey.includes("-" + c.id + "-");
    const clear = isEndpoint ? 0 : EL_CLEAR;
    if (overlap(el, c, clear)) {
      console.warn(`WARN edgelabel-card-overlap: "${el.label}" × card[${c.id}]`);
      warnCount++;
    }
  }
  if (el.x0 < 0 || el.y0 < 0 || el.x1 > canvasW || el.y1 > canvasH) {
    console.warn(`WARN edgelabel-oob: "${el.label}"`);
    warnCount++;
  }
}
for (let i = 0; i < edgeLabels.length; i++) {
  for (let j = i + 1; j < edgeLabels.length; j++) {
    if (overlap(edgeLabels[i], edgeLabels[j], EL_CLEAR)) {
      console.warn(`WARN edgelabel-overlap: "${edgeLabels[i].label}" × "${edgeLabels[j].label}"`);
      warnCount++;
    }
  }
}
for (const c of cards) {
  if (c.x0 < -2 || c.y0 < -2 || c.x1 > canvasW + 2 || c.y1 > canvasH + 2) {
    console.warn(`WARN card-oob: [${c.id}]`);
    warnCount++;
  }
}

// ─── Edge-segment vs body / chrome checks ────────────────────────────────────
function nodeBodyRect(n, forEdge) {
  const tight = nodeObstacleRect(n);
  if (!tight) return null;
  let x0 = tight.x0, y0 = tight.y0, x1 = tight.x1, y1 = tight.y1;
  const inset = 2;
  x0 += inset; y0 += inset; x1 -= inset; y1 -= inset;
  if (forEdge && (n.id === forEdge.from || n.id === forEdge.to)) {
    const isFrom = n.id === forEdge.from;
    const pts = forEdge.pts;
    const p = isFrom ? pts[0] : pts[pts.length - 1];
    const distTop = Math.abs(p[1] - tight.y0);
    const distBot = Math.abs(p[1] - tight.y1);
    const distLeft = Math.abs(p[0] - tight.x0);
    const distRight = Math.abs(p[0] - tight.x1);
    const m = Math.min(distTop, distBot, distLeft, distRight);
    if (m === distTop) y0 += PORT_STRIP;
    else if (m === distBot) y1 -= PORT_STRIP;
    else if (m === distLeft) x0 += PORT_STRIP;
    else if (m === distRight) x1 -= PORT_STRIP;
  }
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function polylineHitsRect(pts, r) {
  if (!r || !pts || pts.length < 2) return false;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    if (segIntersectsRect(x1, y1, x2, y2, r)) return true;
  }
  return false;
}

for (const re of routedEdges) {
  const pts = re.pts;
  // vs every node body
  for (const n of nodes) {
    if (n.x0 == null) continue;
    const body = nodeBodyRect(n, re);
    if (!body) continue;
    if (polylineHitsRect(pts, body)) {
      const role = n.id === re.from || n.id === re.to ? "endpoint-body" : "through-node";
      console.warn(`WARN edge-segment-${role}: ${re.from}->${re.to}${re.label ? ' "' + re.label + '"' : ""} crosses node[${n.id}/${n.label || ""}]`);
      warnCount++;
    }
  }
  // vs note cards
  for (const c of cards) {
    if (!String(c.id).startsWith("note-")) continue;
    if (polylineHitsRect(pts, { x0: c.x0 + 2, y0: c.y0 + 2, x1: c.x1 - 2, y1: c.y1 - 2 })) {
      console.warn(`WARN edge-segment-note: ${re.from}->${re.to}${re.label ? ' "' + re.label + '"' : ""} crosses note[${c.id}]`);
      warnCount++;
    }
  }
  // vs diamonds explicitly (same as nodes with kind decision — already covered, but keep label)
  // vs sidebar / legend chrome
  for (const cr of chromeRects) {
    if (polylineHitsRect(pts, cr)) {
      console.warn(`WARN edge-segment-chrome: ${re.from}->${re.to}${re.label ? ' "' + re.label + '"' : ""} crosses ${cr.kind}[${cr.id}]`);
      warnCount++;
    }
  }
  // sidebar cards tracked as card boxes
  for (const c of cards) {
    if (!String(c.id).startsWith("sidebar:")) continue;
    if (polylineHitsRect(pts, c)) {
      console.warn(`WARN edge-segment-sidebar-card: ${re.from}->${re.to} crosses card[${c.id}]`);
      warnCount++;
    }
  }
}


// ─── Write outputs ───────────────────────────────────────────────────────────
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">\n${out.join("\n")}\n</svg>`;
fs.mkdirSync(outDir, { recursive: true });
const svgPath = path.join(outDir, `${chartName}.svg`);
const htmlPath = path.join(outDir, `${chartName}.html`);
fs.writeFileSync(svgPath, svg);
const pageTitle = (T.title || chartName) + (T.subtitle ? "：" + T.subtitle : "");
fs.writeFileSync(
  htmlPath,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(pageTitle)}</title><style>body{margin:0;background:#e9e2d2}svg{display:block;max-width:100%;height:auto;margin:auto}</style></head><body>\n${svg}\n</body></html>\n`
);
console.log(`wrote ${svgPath} ${htmlPath} (${svg.length} bytes, ${canvasW}x${canvasH}, warns=${warnCount})`);
if (warnCount > 0 && !allowOverlap) process.exit(2);
