# Combo Garage

A buildless Mario Kart World combo picker built around path-traced renders of all 40 vehicles. Serve `dist/` with any static HTTP server and open it:

```
python -m http.server 8080 --directory dist
```

It covers all 50 characters, their 153 outfits and the 40 vehicles: live stat meters by terrain, a searchable picker grouped by shared stats, a meta breakdown, a weighted finder with a combo map, three-way compare, saved combos and shareable links. Saves stay in the current browser.

## Shuffle

Three rows spin in the stage and stop in turn: driver, then kart or bike (50/50), then a vehicle of that type. The third row stays locked until the second lands. A kart or bike is picked first and the vehicle second, so each kart comes up less often than each bike (23 karts against 17 bikes). The meters roll during the spin, show the driver's points when row 1 lands, and add the vehicle at the end. The coin burst grows with the Online meta rank.

Press Shuffle again to skip. Picking a driver or vehicle by hand cancels the spin. With reduced motion on, it picks instantly. Sound uses the game's roulette, stop and coin effects, with a mute button remembered in the browser.

## Layout

- `dist/`: the site (`index.html`, `styles.css`, `app.js`, `data.json`, `fonts/`, `img/`).
- `source/stat-export.json`: the stat export `dist/data.json` is built from.

These stay in the local project and aren't in this repo: the game dump, the original 3840×2560 vehicle renders (`outputs/vehicle-renders-4k/`), the 512×512 coin frames (`outputs/coin-spin/`), the build and render scripts (`tools/`) and the decompiled code (`tools/work/re/`). Paths below refer to that local project.

Rebuild images and data with `tools/.venv/bin/python -I tools/py/build_site_assets.py` (add `vehicles`, `drivers`, `coin` or `sounds` to limit it). The coin frames come from `tools/render/coin_sheet.py`, which smooths the game's low-poly mesh. Stat maths and copy live in `dist/app.js`. Fonts are the game's own, subset to WOFF2.

## Stats

Level = clamp(driver points + vehicle points, 0, 25). The ratio is that level's cell in the performance table, and blank cells are 1.0. Outfits never change stats. Food is left out: it's a timed boost, not a combo stat. CPU racers use a separate table row, so these numbers are for players.

## What each stat does

The hover text comes from tracing each stat through the game's code. Functions are in `main`; decompiled output is in `tools/work/re/stats_*.c` and `apply.c`. The stat enum at `0x3592098` sets the table order: 0x65b660 copies each ratio to the racer's stat block at `+0x178`.

| Stat | Block offset | What the code does | Where |
|---|---|---|---|
| Surface speed | `+0x98` | Road, off-road or water ratio picked each frame; its inverse scales the speed value | `0x65b660` |
| Glide speed | `+0x9c` | Used instead of surface speed in the gliding state | `0x65b660` |
| Acceleration | `+0xa0` | Multiplies the per-frame growth of the racer's speed value | `0x65b660` |
| Surface handling | `+0xac` | Clamped to 0–5, feeds the turn rate | `0x65b660` |
| Handling grip | `+0xb0` | Multiplies the turn rate in the normal steering path | `0x65b660` |
| Weight | `+0xa4`, `1/x` at `+0xa8` | Collision kick scales with 1 ÷ Weight, mapped to ×0.5–×2 | `0x2008b0` |
| Coin speed | `+0xbc` | Shapes the coin curve (below) | `0x656360`, `0x65a220` |
| Mini-turbo | `+0xc0` | Boost frames = `(int)(base × ratio)` | `0x664480` → `0x76dc90`, `0x66dae0` |
| Invincibility | `+0xc4` | Multiplies the post-hit invincible frames | `0x66e2b0` |

Coin curve, with `c = clamp(coins × 0.05, 0, 1)` and `s = clamp(CoinSpeedRatio − 0.5, 0, 1)`:

```
bonus = ease_in + s × (ease_out − ease_in)
ease_out = sqrt(1 − (1 − c)²), ease_in = 1 − sqrt(1 − c²)
speed scale = base + base × 0.05 × bonus
```

Both curves reach 1 at 20 coins, so every combo gets the same maximum. Coin speed only changes how soon you get there.

Invincible base frames are in `Gyml/VehicleTrickSetGParam/TrickSetBase`: 150–200 for spin, crash, big crash and squash, 70–100 for lightning. Tying `0x66e2b0`'s timer to those fields rests on the parameter names and the `InvincibleRatio` name, not on a traced getter.

Not fully traced: the exact state that gates handling grip, what the second value in the Weight calculation is (the code at `0x2008b0` reads it from `+0xe8`), and tire grip, whose readers weren't found. Tire grip, dirt, rail and wall speed, and glide and dirt handling are the same for every combo, so they don't affect any comparison.

## Meta

Competitive picks are Nintendo's published [Mario Kart World Open top 100 (July 2026)](https://www.nintendo.com/us/whatsnew/the-mario-kart-world-open-july-2026-event-results-are-in/), which lists drivers but not vehicles. The Online meta preset is a set of weights tuned so its top pairings match those driver classes. It isn't a race-time model. The vehicle picks in the meta builds rest on community guides and on the stat table.

## License

The BSD 3-Clause license covers this project's own code. The game data, character art, vehicle and coin models, fonts and sounds belong to Nintendo and aren't covered by it.
