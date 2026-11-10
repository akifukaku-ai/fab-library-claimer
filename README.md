# Fab Free Library Claimer

[中文说明](README.zh-CN.md)

A single-file userscript that adds every free listing of a Fab seller to your library in one click. Built for the [Quixel Megascans](https://www.fab.com/sellers/Quixel%20Megascans) library (about 23,000 assets, free since November 2026), and works on any seller page.

## Install

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox, Safari) or [Violentmonkey](https://violentmonkey.github.io/).
2. In Chrome or Edge, turn on **Developer mode** on the extensions page (`chrome://extensions` or `edge://extensions`). Tampermonkey needs it to run scripts.
3. Click **[Install the script](https://raw.githubusercontent.com/akifukaku-ai/fab-library-claimer/main/fab-library-claimer.user.js)**. Tampermonkey opens its install page; click **Install**. Or create a new script in Tampermonkey and paste the whole file in.

## Use

1. Sign in at [fab.com](https://www.fab.com).
2. Open the [Quixel Megascans seller page](https://www.fab.com/sellers/Quixel%20Megascans). On any other Fab page the panel shows an **Open Quixel Megascans** button that takes you there.
3. Click **Start** in the panel at the bottom-right corner.
4. Keep the tab open. The panel shows how many listings were scanned, already owned, added and failed.

| Button | What it does |
|---|---|
| Start / Resume | Starts, or continues from the last saved page |
| Stop | Stops after the current batch |
| Reset | Clears saved progress and starts over next time |
| – | Collapses the panel |

## Good to know

- Listings you already own are skipped, so running it again is safe. Run it once more after a few days to pick up listings that turned free later.
- Progress is saved after every page. Closing the tab or the browser loses at most one page of work.
- A full run of 23,000 listings takes a while. If Fab rate-limits you, the script waits and retries on its own.
- Nothing is downloaded. Assets only go into your Fab library; download them later from Fab, Unreal Engine or Bridge.
- The script talks only to fab.com, using your own signed-in session. It collects nothing.

## Troubleshooting

- **"Please sign in to Fab first."** Sign in and click Start again.
- **Failed keeps going up.** Fab may have changed its site. Open an issue with a screenshot of the panel.
- **No panel.** Make sure the script is enabled in Tampermonkey and Developer mode is on, then reload the page.

## License

MIT
