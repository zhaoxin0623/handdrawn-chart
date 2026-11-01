---
name: handdrawn-chart
description: Draw a cream-paper pencil-jitter statechart from a JSON graph (SVG/HTML/PNG). Use when the user wants a hand-drawn diagram, statechart, flow chart with ticket nodes, or to run draw.mjs / render.sh.
---

# Hand-drawn chart

This plugin ships a **zero-npm** renderer. From the **plugin root** (the directory that contains `draw.mjs`):

```bash
node draw.mjs <graph.json> --out <dir> [--name chart] [--allow-overlap]
./render.sh <dir> <name>
node check-text.mjs <graph.json> <required.txt> --svg <dir>/<name>.svg
node draw.mjs --self-test-wrap
```

`CHROME` overrides the browser used by `render.sh` (default `/usr/bin/google-chrome`, else macOS Chrome.app). On some Linux sandboxes the distro Chrome hangs on `--screenshot`; point `CHROME` at another Chromium build if needed.

Exit code `2` from `draw.mjs` means overlap / out-of-bounds `WARN` lines (bypass with `--allow-overlap`).

## When to use

- User asks for a hand-drawn / paper / ticket-style statechart or flow diagram
- User provides states, groups, edges and wants SVG/PNG output
- User wants to iterate on a graph JSON then re-render

## How to write the graph JSON

Minimal shape:

```json
{
  "seed": 42,
  "width": 1000,
  "title": { "kicker": "", "title": "", "subtitle": "" },
  "groups": [{ "id": "g1", "label": "Group", "color": "#5b8fd6", "layout": "column" }],
  "nodes": [
    { "id": "start", "kind": "start", "label": "" },
    { "id": "a", "group": "g1", "label": "state", "sub": "optional", "kind": "normal" }
  ],
  "edges": [{ "from": "start", "to": "a", "label": "go", "style": "normal" }],
  "notes": [{ "text": "slip", "group": "g1", "side": "left" }],
  "legend": [{ "swatch": "bug", "text": "…" }],
  "sidebar": { "title": "Side", "panels": [{ "title": "A", "lines": ["…"] }] },
  "illustrations": [{ "kind": "person", "near": "g1", "side": "left" }],
  "footer": "…"
}
```

### Field notes

| Field | Notes |
| --- | --- |
| `groups[].layout` | `column` = ranks top→bottom; `row` = ranks left→right |
| `nodes[].kind` | `normal` \| `bug` \| `fix` \| `decision` \| `start` \| `chip` |
| `nodes[].color` | optional fill/edge override (evaluators etc.) |
| `nodes[].label` | `\n` allowed; long lines **wrap** (CJK per char, Latin/number runs stay intact; no hanging `）).,!?%`) |
| `edges[].style` | `normal` \| `bug` \| `fix` \| `muted` |
| `illustrations[].kind` | `person` \| `programmer` \| `scorer` |
| `seed` | deterministic pencil jitter |
| `legendTitle` | legend box heading (default `Legend`) |
| `illustrations[].caption` | optional figure caption under person/scorer |

Auto layout ranks nodes inside each group by longest path from group-local sources. Groups stack vertically; optional sidebar is on the right; canvas height grows with content.

## Workflow for Claude

1. Draft or edit a `*.json` graph (see `examples/coffee-order.json`).
2. `node draw.mjs path/to/graph.json --out out --name <name>`
3. Fix any `WARN` lines until **warns=0**. Do **not** deliver with `--allow-overlap` unless the user explicitly accepts residual overlaps.
4. `./render.sh out <name>` for PNG.
5. Optional: put required strings in `*.required.txt` and run `check-text.mjs`.
6. Show the user the PNG / HTML.

### Mandatory verification before delivering (do not skip)

Self-check must report **0 WARN**, including both:

- **Edge-label** checks (label vs node/diamond text, notes/cards, other edge labels, clearance).
- **Edge-segment** checks (`edge-segment-through-node`, `edge-segment-endpoint-body`, `edge-segment-chrome`, `edge-segment-sidebar-card`): no polyline may pass through another node body, through the interior of its own endpoints (port strip excluded), or through the sidebar/legend.

Then **visually Read the PNG** (and crop/zoom problem regions if needed) before claiming the chart is done. Confirm: no red/green line crosses card text; edges are short card-to-card (not long outer detours); sidebar/legend are never edge endpoints.

Prefer editing JSON over hand-editing SVG. Keep labels verbatim when the user supplies them; wrap instead of truncating. Route edges only between `nodes` — never to sidebar/legend items.
