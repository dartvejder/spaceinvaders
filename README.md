# Void Swarm

An original fixed-shooter arcade game for the web browser, rendered in 3D:
hold the line at the bottom of the screen against descending swarm formations.

Built with plain HTML, CSS and JavaScript modules plus [three.js](https://threejs.org)
for the WebGL scene (lit 3D models, perspective camera, bloom). three.js is
vendored in `vendor/three`, so there is no build step and nothing to install.

## Play

The game uses JavaScript modules, which browsers only load over HTTP, so serve
the folder rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

| Action | Keyboard | Touch / mouse |
| --- | --- | --- |
| Move | `←` `→` or `A` `D` | Drag anywhere |
| Fire | `Space` (hold) | Hold (auto-fire) |
| Pause | `P` or `Esc` | Pause button |
| Mute | `M` | Speaker button |
| Start / restart | `Enter` | Tap |

## Gameplay

- **Darts** (green) peel off the formation and dive at you — worth double when
  shot mid-dive.
- **Orbs** (pink) fire aimed shots.
- **Hulls** (orange) take three hits.
- Every fifth wave is a **Warden** boss fight.
- The swarm speeds up as it thins out, and the game ends if it reaches your line.
- Power-ups: `R` rapid fire, `S` spread shot, `B` one-hit barrier, `+` extra life.

The best score is kept in `localStorage`.

## Code layout

- `game.js` — game rules, input, sound, and the HUD/menus (a 2D canvas layered
  over the scene). All logic runs in a flat 360×640 coordinate space.
- `scene3d.js` — mirrors the game state into a three.js scene each frame.
- `vendor/three` — three.js (MIT licence) and the post-processing passes used.

## Notes for the Android version

The game was laid out with a phone port in mind:

- All logic runs in a fixed 360×640 portrait coordinate space that is scaled to
  the screen, so nothing depends on the browser window size.
- Game rules are separate from rendering, so the rules can be ported as-is
  while the renderer is swapped, or the whole page can run in a WebView.
- Input is pointer-event based, with drag-to-move and auto-fire for touch.
- Sound is synthesized at runtime; there are no asset files to bundle.
- The game pauses itself when the page loses focus or is hidden.
