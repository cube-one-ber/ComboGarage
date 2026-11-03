# Developing Combo Garage

[← Back to Combo Garage](../README.md) · [How it works](how-it-works.md)

Combo Garage is buildless. Serve `dist/` with any static HTTP server and open it:

```sh
python3 -m http.server 8080 --directory dist
```

Run this from the repository root, then open [localhost:8080](http://localhost:8080).

## Layout

- `dist/`: the site (`index.html`, `styles.css`, `app.js`, `data.json`, `fonts/`, `img/`).
- `source/stat-export.json`: the stat export `dist/data.json` is built from.
- `source/meta-usage.json`: what top players race with, from Nintendo's World Open top 100s and the standing time trial records. See [How it works](how-it-works.md#meta).

These stay in the local project and aren't in this repo: the game dump, the original 3840×2560 vehicle renders (`outputs/vehicle-renders-4k/`), the 512×512 coin frames (`outputs/coin-spin/`), the build and render scripts (`tools/`) and the decompiled code (`tools/work/re/`). Paths below refer to that local project.

Rebuild images and data with `tools/.venv/bin/python -I tools/py/build_site_assets.py` (add `vehicles`, `drivers`, `coin`, `sounds` or `data` to limit it; `data` rewrites only `data.json`). To refresh the Meta data after a new World Open or record, run `tools/.venv/bin/python -I tools/py/fetch_meta_usage.py`, then the build with `data`. It keeps only events on the current stats, so if a game update changes driver or vehicle stats, move `REBALANCE` in the fetch script to that update's date. The coin frames come from `tools/render/coin_sheet.py`, which smooths the game's low-poly mesh. `coin` writes two sheets: `coin.webp` for the shuffle burst, loaded on demand, and the much smaller `coin-sm.webp` for the coin counter. Stat maths and copy live in `dist/app.js`. Fonts are the game's own, subset to WOFF2.

## Search appearance

The title, description, canonical URL, Open Graph metadata and `WebSite` structured data live in `dist/index.html`. The preferred site name is **Combo Garage**. If the public domain changes, update the URLs there and in `dist/robots.txt` and `dist/sitemap.xml` together.

The crawlable favicons use the site's chequered flag. Their editable source is `source/favicon.svg`; regenerate the committed icons with ImageMagick and librsvg:

```sh
rsvg-convert -w 384 -h 384 source/favicon.svg -o /tmp/combo-garage-favicon.png
magick /tmp/combo-garage-favicon.png -resize 96x96 -strip dist/favicon.png
magick /tmp/combo-garage-favicon.png -define icon:auto-resize=48,32,16 -strip dist/favicon.ico
magick /tmp/combo-garage-favicon.png -resize 180x180 -background '#f4f1ea' -alpha remove -alpha off -strip dist/apple-touch-icon.png
```

After deployment, request indexing of `https://combogarage.pages.dev/` in Google Search Console and submit `sitemap.xml`. Google chooses the final search appearance; the new site name and favicon take effect only after it recrawls and processes the site.
