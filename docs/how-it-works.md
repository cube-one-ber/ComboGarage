# How Combo Garage works

[← Back to Combo Garage](../README.md) · [Development](development.md)

How the site behaves, and how each number traces back to the game.

## Shuffle

Three rows spin in the stage and stop in turn: driver, then kart or bike, then a vehicle of that type. The third row stays locked until the second lands. Every vehicle is equally likely, so the second row lands on kart or bike 23:17, matching how many of each there are. The meters roll during the spin, show the driver's points when row 1 lands, and add the vehicle at the end. The coin burst grows with the Online meta rank.

Press Shuffle again to skip. Picking a driver or vehicle by hand cancels the spin. With reduced motion on, it picks instantly. Sound uses the game's roulette, stop and coin effects, with a mute button remembered in the browser.

## Coins

The band under the garage sets how many coins you're holding, from 0 to 20, with the slider, the − and + buttons, or by clicking, dragging or arrow-keying either coin chart. It shows top speed on all seven surfaces and follows hover previews. The Speed meter, the coin chart in Meta and the speed chart in Compare use the same count, and links carry it as `c` (`?d=…&v=…&c=7`, left out at 0).

Speeds are multipliers, where ×1.000 is neutral, because the game has no speed unit the site could quote. Levels, the Online meta score and the finder don't change with coins, since they rank stats rather than a moment in a race.

## Stats

Level = clamp(driver points + vehicle points, 0, 25). The ratio is that level's cell in the performance table, and blank cells are 1.0. Outfits never change stats. Food is left out: it's a timed boost, not a combo stat. CPU racers use a separate table row, so these numbers are for players.

## What each stat does

The hover text comes from tracing each stat through the game's code. Functions are in `main`; decompiled output is in `tools/work/re/stats_*.c` and `apply.c`. These paths refer to the local research project, not files included in this repository; see the [development notes](development.md#layout). The stat enum at `0x3592098` sets the table order: 0x65b660 copies each ratio to the racer's stat block at `+0x178`.

| Stat | Block offset | What the code does | Where |
|---|---|---|---|
| Surface speed | `+0x98` | Road, off-road, dirt, water, rail or wall ratio picked each frame; its inverse scales the speed value | `0x65b660` |
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
top speed ∝ surface ratio × speed scale
```

Both curves reach 1 at 20 coins, so every combo gets the same maximum. Coin speed only changes how soon you get there.

The top speed line is what the site shows. `0x654360` builds the speed cap at `+0x21c` as surface ratio × speed scale × race class ÷ a table value (`0x2d6bf80`, 1.57 in the normal gear), and `0x65a220` builds the speed scale. Class and table value are the same for every combo, so the two ratios decide it. `base` is 1.0 in normal driving, and gliding swaps the surface ratio for the glide ratio without touching the speed scale, so coins count there too.

The speed scale applies on every surface, including rails and walls. Each frame `0x65b660` picks the surface stat, with rail (`+0x5c` bit 14) and wall (bit 17) ahead of the ground checks, then `0x65b660` and `0x654360` combine it with the inverse of the speed scale into the speed cap. Dirt, rail and wall are ×1.0 on every combo, so the speed scale is the only thing separating combos there: they all match at 0 coins, higher coin speed leads from 1 to 19 coins, and they match again at 20. At 1 coin the bonus runs from +0.2% to +1.4%. The gap peaks at 2.7 points at 10 coins. Rails also multiply the target speed by `RailSlideSpeedRate` (`+0xb8`), which is 1.0 from the constructor at `0xecdca0` and isn't set in any game file. It doesn't vary by combo.

Invincible base frames are in `Gyml/VehicleTrickSetGParam/TrickSetBase`: 150–200 for spin, crash, big crash and squash, 70–100 for lightning. Tying `0x66e2b0`'s timer to those fields rests on the parameter names and the `InvincibleRatio` name, not on a traced getter.

Not fully traced: the exact state that gates handling grip, what the second value in the Weight calculation is (the code at `0x2008b0` reads it from `+0xe8`), the check that gates the coin bonus (`+0x40 == 5` in `0x656360`), and tire grip, whose readers weren't found. Tire grip and glide and dirt handling are the same for every combo, so they don't affect any comparison.

## Meta

Competitive picks are Nintendo's published [Mario Kart World Open top 100 (July 2026)](https://www.nintendo.com/us/whatsnew/the-mario-kart-world-open-july-2026-event-results-are-in/), which lists drivers but not vehicles. The Online meta preset is a set of weights tuned so its top pairings match those driver classes. It isn't a race-time model. The vehicle picks in the meta builds rest on community guides and on the stat table.
