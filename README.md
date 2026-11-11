# Void Swarm

An original fixed-shooter arcade game for the web browser: hold the line at the
bottom of the screen against descending swarm formations.

No build step and no dependencies — plain HTML, CSS and one JavaScript file
drawing to a canvas.

## Play

Open `index.html` in a browser, or serve the folder:

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

## Notes for the Android version

The game was laid out with a phone port in mind:

- All logic runs in a fixed 360×640 portrait coordinate space that is scaled to
  the screen, so nothing depends on the browser window size.
- Input is pointer-event based, with drag-to-move and auto-fire for touch.
- Sound is synthesized at runtime; there are no asset files to bundle.
- The game pauses itself when the page loses focus or is hidden.
