# Combo Garage

A buildless Mario Kart World combo picker. Serve `dist/` with any static HTTP server, e.g. `python -m http.server 8080 --directory dist`, and open http://localhost:8080.

Includes all 153 driver/outfit entries and 40 vehicles from the existing stat export, terrain-aware stats, all 19 levels and multipliers, prioritized recommendations, local saved combos, three-way comparisons, and URL sharing. Saves stay in the current browser.

Game data is in `dist/data.json`; artwork was converted from `output/UI/Textures`. The Standard Kart studio image was produced through Blender MCP from the exported FBX with extracted diffuse textures. The packed Blender scene is `../outputs/combo-garage-studio.blend`.

Level = clamp(driver points + vehicle offsets, 0, 25). Multiplier = level curve value, defaulting to 1.0 for blank ratio cells. The in-app data dialog includes executable evidence offsets from the existing verified workbook pipeline. No food stats are included.

Recommendations use raw levels, with an explicitly documented equal-weight core-stat mean for All-rounder. Higher weight or handling is a preference; recommendations do not claim race-time superiority.
