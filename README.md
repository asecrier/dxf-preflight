# DXF Preflight

Static, client-side web tool: checks ASCII DXF files for laser/CNC cutting (open contours, duplicates, units), repairs them, measures cut length and pierces, and calculates a job price. No server, no upload, no dependencies.

## Run locally
```
python -m http.server 8765      # in this folder
# open http://localhost:8765/index.html
```
Or open `index.html` directly in a browser.

## Files
- `dxf.js` – parser, analysis, repair, export, quote model (no DOM).
- `app.js`, `index.html` – UI.
- `tests/make_samples.py` – generates sample DXFs (`clean_plate`, `defective_plate`, `rounded_bulge`). Expected: clean cut 382.832, rounded 302.832, defective → 2 duplicates, 1 open shape (0.05 gap) closed by 0.1 mm join.

## Decisions
- No framework/build step: hosts for free anywhere (GitHub Pages, Cloudflare Pages, Netlify).
- Output limited to LINE/ARC/CIRCLE in mm for max CAM compatibility; splines/ellipses become segments.
- Pierces = number of connected shapes (estimate; shared edges/T-junctions flagged).
- Limitations: ASCII DXF only; no DWG; partial overlaps not detected; non-uniform scaled blocks approximated.

## Publishing status
See ../PORTFOLIO.md. Config for contact/checkout in `app.js` (`CONFIG`) – empty until real values exist.
