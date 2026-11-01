---
description: Draft or update a hand-drawn statechart JSON and render SVG/PNG with this plugin's draw.mjs
---

Use the **handdrawn-chart** skill workflow.

1. Confirm the plugin root (directory containing `draw.mjs`).
2. Write or update a graph JSON (schema in the skill / README). Start from `examples/coffee-order.json` if helpful.
3. Render:
   - `node draw.mjs <graph.json> --out out --name <name>`
   - `./render.sh out <name>`
4. Report WARN/overlap output and the paths of `.svg`, `.html`, and `.png`.
5. Do not truncate user-provided label text; rely on wrapping.
