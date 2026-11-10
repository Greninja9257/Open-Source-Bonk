# To do

> [!IMPORTANT]
> **Nothing on this list gets invented.** Every item is built by reading the real bonk.io
> implementation and reproducing what it actually does. Not an approximation of it, not
> something that looks close, not a reasonable guess at what it probably does.
>
> That means, for every item: deobfuscate the bundle and read the code for that behaviour
> (`resources/deobfuscator/`), and where it's visual or timed, capture the live game and
> measure it. Use the original's own assets. Use the original's own numbers, easing and
> timings. Do not substitute your own art, your own constants or your own animation curves
> because they seem right.
>
> If the original can't be read or captured for some detail, stop and say so. An unanswered
> question written down is fine. A made-up answer is not, and has already cost this project
> real time: the bow limb was rebuilt several times from invented geometry before anyone used
> the texture the game actually ships.
>
> Record what you measured, and where it came from, in `comparisons/`.

## Accounts

- **Guest accounts, login and signup**, exactly as bonk.io does them.
- **Skin editor.**

## UI and chrome

- **Top bar auto-hide.** One behaviour **everywhere**, with one addition in the main menu.
  An earlier note here said the bar is always visible in the lobby; that was wrong and the
  lobby is not a special case.

  **Done.** `client/top-bar.js` is shared by the game page and the menu page so the two
  cannot drift. In a game and in a lobby it is the original's rule with its own numbers --
  50px from the top of the game area, 120ms each way, `easeOutSine` down, `easeInSine` up,
  between `top: 0` and `top: -40px`. In the main menu the bar and the menu buttons stay up
  while the pointer is over the page and both hide when it leaves, with no idle timer.
  The game canvas was also inset by the bar's height; it now fills the page top to bottom
  and the bar floats over it. See `comparisons/lobby-evidence.md`.
- **Popups animate in and out.** The round-end popups — "Draw", the winner line and the
  leaderboard under it — appear and disappear smoothly in the original. This build snaps
  them on and off. The element is the original's own `#ingamewinner` (with `_top`,
  `_bottom`, `_skin` and `_scores`), captured in `resources/source/css/simplemenu.css`,
  but that stylesheet carries no transition or keyframes for it, so the animation is run
  from the client's code and has to be read out of the bundle — the curve and duration are
  not to be invented.

- **Heavy should show on the winner popup's ball, live.** Wanted: while the round-end
  popup is up, the ball in it reacts to the heavy key the way the player's disc does in
  game, so whoever won can spam heavy and make the popup's ball flash. A win celebration.

  **Flagged as an addition, not parity, until someone proves otherwise.** Everything read
  so far says the original's popup is a still image: it builds the winner's avatar with
  `AvatarRenderer.createImage(...)` into `#ingamewinner_skin_skin` and keeps it in a
  `winnerAvatarCache` keyed by team (bundle lines 15825-15833, and the same again at
  17594-17602). A cached image does not follow a key being held. That is evidence, not
  proof — it does not rule out something else redrawing it — so before this is built
  either confirm the original does it and reproduce that, or record it in `comparisons/`
  as a deliberate difference with this entry as the reason. Capture is cheap: win a round
  on bonk.io and hold heavy while the popup is up.

  **It is blocked on a real gap first.** This build has no heavy visual *anywhere*. Heavy
  only changes physics -- `client/physics.js:327` scales the disc's density by
  `heavyStrength` -- and nothing in `client/` draws it, so there is no "heavy circle"
  to put on the popup yet. The in-game appearance has to be read out of the bundle and
  built on the disc before the popup can echo it. `comparisons/official-heavy.png` and
  `comparisons/local-heavy.png` are the pair to work from.

  Then the popup. `drawWinnerBall` (`client/game-ui.js:81-95`) paints a flat disc of the
  winner's colour into a 200x200 canvas once -- `arc(100, 91, 78)` -- so it would need to
  redraw on a frame loop while the popup is visible, reading the winner's live heavy
  state. That state already exists on the disc: `a1` is the key held and `a1a` the meter
  from 0 to 1000 in the original, which this build mirrors as `heavyStrength`
  (`client/mode-runtime.js:172-176`). Two things to settle when building it: whether the
  popup follows the **winner's** heavy or the **local player's**, and that a round is
  over, so nothing here may feed back into the simulation -- it is drawing only.

- **Off-screen player marker.** When a player is outside the camera, the original shows an
  arrow at the edge pointing to them, in that player's **base colour**, with their **name**.
  This build shows nothing, so a player off-screen is simply lost. Nothing about this is in
  the captured CSS or graphics, because it is drawn into the game canvas rather than the
  DOM; its shape, its placement against the edge, and where the name sits all have to come
  from the bundle and from capture.

- **Window resizing.** The build does not lay out well as the window changes size. It is
  visible in `comparisons/local-20261107-*.png`: in the lobby at 800px the map preview
  overlaps the "Classic" and "Rounds to win" labels in the Game Settings panel, and the
  player boxes crowd the chat. The original's own stylesheets size the lobby in
  percentages against `#newbonklobby`, so the places where this build has substituted
  fixed pixels are the ones to find. Needs capture at several sizes and a comparison
  against the original at the same sizes.

- **Host indicator has no outline. Done.** The question this item asked -- text-stroke,
  four-way text-shadow or a different face -- had a false premise: the original's H is
  not styled text at all. It is an `<img>`, and the outline is painted into the artwork.
  The captured `.newbonklobby_playerentry_host` rule sets position only, with no font or
  colour, which was the clue. The bundle builds the row with `graphics/host_<n>.png`, and
  the ready **check** is the same -- an `<img src="graphics/readytick.png">` added only
  when the player is ready, at its own position, so a ready host now shows both at once
  where the old single element could only show one. Both images are the original's own
  and are stored in `resources/source/graphics/`. See `comparisons/player-row-evidence.md`.

  **Done means the outline, not the whole H.** The image is still chosen by a constant,
  so its colour does not track the host's connection the way the original's does. That
  is the next item, and it is where the full set of `host_*` images gets used.

- **Ping indicator in the player list, and the host H's colour with it.** Two faults,
  one cause. In the original every row carries a signal-bar icon and, under it, the
  latency in milliseconds -- `comparisons/official-lobby-reference.png` catches it as
  five green bars over `17ms`. This build shows neither.

  The second fault is easy to miss because it currently *looks* right. The host **H** is
  tinted by that same latency, and `client/shell.js:332` pins it to a constant:

  ```js
  const HOST_IMAGE = '/reference/graphics/host_5.png';
  ```

  So the H is always the green, under-100ms image. **A host on a 2000ms connection still
  shows green**, where the original would show the red `host_1.png`. Nothing in the
  client or the server measures latency at all -- every match for `ping` in either file
  is a comment -- so there is no value for it to track. It matches the original in the
  one state this build can be in, serving from localhost, and nowhere else. That is a
  parity defect, not a finished feature, and it is what this item fixes.

  All of it is already read out of the bundle (`updatePings`) and the captured CSS, so
  nothing here needs guessing:

  | | |
  | --- | --- |
  | Icon | `<img class="newbonklobby_playerentry_ping" src="graphics/ping_<n>.png">`, positioned by the captured rule -- `right:20px`, vertically centred |
  | Text | `<div class="newbonklobby_playerentry_pingtext">`, `right:18px`, `top:29px`, 9px `futurept_book` in `#4e4e4e`, `width:25px`, centred |
  | Band | `n` is **5** at 100ms or less, then **4**, **3**, **2**, **1** as the ping passes 100, 200, 300 and 400 |
  | Tabbed out | `n` becomes `"tab"` and the text reads `Tab` rather than a number |
  | Wording | `"<ping>ms"`, or `"-ms"` when the ping is not known yet |
  | Host H | `graphics/host_<n>.png` with that same `n` -- one lookup drives both |

  Two things are genuinely missing rather than unread. The **assets**: `ping_1..5.png`
  and `ping_tab.png` are not captured yet (`host_0..5` and `host_tab` already are, in
  `resources/source/graphics/`). And the **measurement**: this build has no latency
  figure anywhere -- no round trip is timed and `lobbyState` carries no `ping` field, so
  the server needs to time each socket and send it per player before any of the above has
  a number to show. The original also redraws only when the band changes, keeping a
  `lastSet` per image rather than reassigning `src` every update; worth keeping, since
  this runs on a timer.

- **Exit flow.** What the original does, context by context. See
  `comparisons/exit-evidence.md`.

  | Where | Who | Exit does |
  | --- | --- | --- |
  | Tutorial | anyone | leaves at once, no confirmation — **done** |
  | Quick play | anyone | Leave Game window — **done** |
  | Custom game, in game | not host | Leave Game window — **done** |
  | Custom game, in game | host | leaves at once **to the lobby**, not the menu — **done** |
  | Custom lobby | host, alone | Leave Game window — to do |
  | Custom lobby | host, others present | `#hostleaveconfirmwindow` — to do |

  The host window is the original's own and is wider (390px against 310px) because it has
  three buttons, not two: Cancel, Ok and **End Room**. Ok leaves the room and passes host to
  the **top player in the list** — the earliest to join after the host. End Room closes the
  room for everyone.

  **Its markup and wording are no longer unread.** Both windows sit in the live
  `gameframe-release.html` from page load, hidden, and were read straight off bonk.io on
  November 7, 2026 — the element, its three button ids, their positions and the exact
  wording, including the third button reading **"End Room"** rather than "End" as this list
  used to say. It is copied out in `comparisons/exit-evidence.md`, alongside the styling
  that was already captured in `resources/source/css/pagelayout.css`.

  The in-game host row is done: a one-time token minted at `lobbyStart` and handed only to
  the host survives the handoff, so the game page knows who the host is. The host's exit
  does not ask -- it stops the game and returns everyone to the room's lobby.

  Blocking the two lobby rows is now only the server: it has no host transfer (to the
  earliest joiner) and no end-room message. What Ok and End Room actually *do* was also not
  read out of the original — the handoff rule above is the owner's account of it — so that
  is the part to confirm while building it.

## Lobby

- **Chat can't be reached — bug. Done.** Enter now focuses the input and toggles
  `pointerEvents` and the "Press enter to send a message" line exactly the way the
  original's own handler does, and Enter again sends, blurs and puts both back. The
  `pointer-events: none` rule is the original's and was left alone. See
  `comparisons/lobby-evidence.md`.

- **System messages.** Partly done. Joining, leaving, the countdown and the aborted
  countdown now carry the original's wording, its `* ` prefix and its own per-message
  colour, and the chat keeps the original's 250-line cap and its only-follow-if-at-the-
  bottom scrolling. `comparisons/lobby-evidence.md` has the table and the line numbers.

  Still to do: the host lines (`has left the game and closed the room.`, `... and <name> is
  now the game host.`, `You are now the host of this game.`, `has given host privileges
  to ...`), which are read and written down but need the host flow under **Exit flow**
  first; and the rest of the palette -- friend events `#00675d`, rate limiting `#cc4444`,
  the `/` command help -- none of which this build has. The original also plays a sound
  with most of these; the message carries the flag but this build has no sound at all.

- **Non-host controls in a custom room.** A player who is not the host still gets the map
  and start controls, but changed:

  **Done.** The original greys four, not three -- it greys the teams button too -- and
  never greys the map button:

  | Control | Non-host |
  | --- | --- |
  | Map | opens for everyone; choosing **suggests** rather than picks |
  | Editor | greyed |
  | Start | shown, greyed |
  | Mode | greyed |
  | Teams | greyed |

  All four use the original's own `.brownButtonDisabled` (`#777777`, no pointer events).
  The suggestion renders in the chat as the original's five spans. See
  `comparisons/lobby-evidence.md`.

- **Start with one player skips the lobby countdown. Done.** All three parts of the
  original's start handler are reproduced. It counts the room -- every entry in the
  player list, spectators included, since it does not filter them -- and one player calls
  `startGame` directly with no 3-2-1 in the chat, while more than one sets the 3 second
  countdown. While that runs the Start button reads **"Abort"**, and pressing it then
  cancels, which is what the `* Countdown aborted!` line was already there for. The
  original sends the cancel as its own message rather than reusing start, so the server
  takes `lobbyAbortCountdown` beside `lobbyStart`.

  Only the host's own button ever reads "Abort": the original sets the label inside the
  handler a non-host returns from before reaching. The label goes back to "Start" when
  the countdown is cancelled from either end, when host is lost mid-countdown, and when
  the lobby is left, which is the original's `hide()`.

  Consistent with the round-start table below, which already says a one-player custom room
  gets no chat countdown. The test that asserted the old behaviour -- a lone host counting
  in 3-2-1 -- encoded the defect, and now covers both branches and the abort.

- **Lobby background should be the map, blurred.** The lobby currently sits on flat
  colour: `client/shell.css:6` hides the backdrop outright in the lobby
  (`#simpleMenuContainer.lobby #arenaBackdrop{display:none}`). The original puts the
  selected map back there, blurred and darkened.

  Already checked, so this is not invented: in `comparisons/official-lobby-reference.png`
  the background is the same map as the thumbnail, softened and dimmed. Sampling the
  map's tan `#debe8b` against the background's `#594c38` gives **x0.40 on all three
  channels**, a uniform darkening rather than a tint. No `blur` appears anywhere in the
  captured CSS, so it is not a stylesheet rule -- it is applied to the render, and how
  has to come out of the bundle.

  Still to read or capture: the blur radius, whether the darkening really is a flat x0.40
  multiply or a black overlay at 60%, the zoom and framing against the map, whether it is
  a live render or a still, and whether it follows the map changing. The physics are
  already in `lobbyState` and `drawLobbyMap` already renders them, so the source is to
  hand once the numbers are.

## Round start

This replaces the current behaviour, where the world freezes for 90 frames at the start of
every round and the numeric countdown is shown whenever it's frozen. That isn't what the
original does. `comparisons/round-evidence.md` wrote it up as a deliberate difference, which
was wrong; the note has been corrected to call it a defect and points here.

The map card is the bonk.io overlay with the map name on top, `by` in the middle and the
author underneath, animated the way the original animates it.

| | Chat countdown | First round | Later rounds |
| --- | --- | --- | --- |
| Quick play | no | map card, no in-game countdown | map card, no in-game countdown |
| Custom, 2+ players | yes | map card, no in-game countdown | in-game countdown, no map card |
| Custom, 1 player | no | map card, no in-game countdown | in-game countdown, no map card |

Quick play never shows the in-game countdown, on any round. The chat countdown is the one in
the chat panel and is separate from the in-game numeric one.

## Assets

- **Everything is served locally. Done, and guarded.** Nothing the pages load comes from
  bonk.io or any other host at runtime: loading the menu, the Quick Play window and a game
  made 69 requests, every one of them to this server. A test walks `client/` and fails if
  a remote URL appears in any html, js or css.

- **Quick Play thumbnails. Done.** They were cut off with a black band across the bottom
  because this build used `thumb_classic.jpg`, `thumb_arrows.jpg` and `thumb_grapple.jpg`.
  Those files are genuine -- byte for byte what bonk.io serves -- but they are not what
  the original *shows*: its own markup points at `thumb_classic_nb.jpg` and the other two
  `_nb` variants, which are the same artwork without the band. The three `_nb` files are
  now stored in `resources/source/graphics/`. The lobby's map preview was also seeded with
  the black-banded `thumb_classic.jpg`; the original leaves that container empty and fills
  it from the map, so the placeholder is gone.

## Chat

- **Chat stops scrolling and gets stuck -- bug.** The chat works, and then it doesn't: new
  messages keep arriving but the panel no longer follows them to the bottom and looks
  frozen. `appendChatLine` (`client/shell.js:97-103`) decides whether to follow *before*
  appending, by testing `scrollTop + clientHeight >= scrollHeight - 5`. Anything that
  leaves the container a few pixels short of the bottom latches it into the
  "not at the bottom" branch and it never recovers by itself -- candidates are the 250-line
  trim removing `firstChild` and shifting `scrollTop` under the test, a line whose height
  changes after the measurement, and the panel being measured while hidden, where all three
  values read 0. The same measure-then-append shape is in the in-game chat.

  Not yet reproduced deliberately. Find the trigger first -- log the three values per
  message, or capture a session until it sticks -- and fix that. Do **not** paper over it by
  setting `scrollTop = scrollHeight` unconditionally: that would break the original's own
  rule, already implemented, that scrolling back to read is not yanked away by new
  messages.

- **Cursing filter. Done.** It replaces each matched word with the literal text `bonk`,
  using the original's own 94-word list and 40-entry normalisation table, lifted out of
  the bundle rather than retyped, and repeating so several words in one message are each
  replaced. It runs on receipt, per viewer, in both the lobby and the in-game chat. The
  invented four-word bullet filter this build had is gone. One deliberate difference, and
  the reason, is recorded in `comparisons/lobby-evidence.md`.

## Effects

- **Death particles.** An explosion, fast-ish.
- **Impact particles** for a player striking map geometry, like a platform. Player-on-player
  contact produces nothing; the original has no such effect.
- **Sound and music** from bonk.io.

## Performance and loading

- **Things flash on load. Fonts and the map preview done; the rest still open.**

  - **Fonts. Done.** Every `@font-face` in the build's own CSS now carries
    `font-display:block`, and each page preloads the faces it uses with
    `<link rel="preload" as="font" type="font/otf" crossorigin>` -- the `crossorigin` is
    required even same-origin or the file is fetched twice. `block` is the one that suits
    a parity build: the reader never sees a fallback face swap out from under them, and
    with the bytes already in flight the hold is a few milliseconds. `futurept_book_fixed`
    was also declared in both `shell.css` and `parity.css`, which cost a second fetch of
    the same file; the `shell.css` copy is gone and `parity.css`, which both pages load,
    keeps it.

    Measured cold with the cache disabled, before against after:

    | | Before | After |
    | --- | --- | --- |
    | Preload links (menu) | 0 | 7 |
    | `font-display` | none on any of the 8 declarations | `block` on all 7 |
    | First font request (menu) | starts 130ms | starts 35ms |
    | All fonts in (menu) | 142ms | 55ms |
    | First font request (game) | -- | starts 9ms, all in by 14ms |
    | Duplicate fetch of `fptbook_fixed_5.otf` | yes | no |

    The menu paints its first screen in `futurept_b1`, `futurept_book`,
    `futurept_book_fixed` and `futurept_light`, and those four were all the old build ever
    fetched. The preload list is wider than that on purpose: `futurept_medium`,
    `futurept_demi` and `futurept_bold` are the lobby's and the round-end popup's faces,
    and under `font-display:block` an unpreloaded face means invisible text at the moment
    that panel first appears. Chrome raises no unused-preload warning on either page.

  - **Map preview. Done.** `drawLobbyMap` is keyed on the map actually changing, so the
    thumbnail is no longer cleared to `#304356` and rebuilt from the physics on every
    `lobbyState`. Counting full repaints across six `lobbyState` updates -- six ready
    toggles -- it is **6 before, 0 after**. What is drawn is untouched.

  Still open here: a `document.fonts.ready` gate before the first paint of an affected
  panel, drawing the map once to an offscreen canvas or `ImageBitmap` and blitting it
  rather than replaying the bodies on the first draw, the per-frame work in the game loop,
  and the full DOM rebuild of the player list on each `lobbyState`
  (`client/shell.js:120-153`) -- that last one still replaces every row on every update,
  which is also why the preview fix had to be a guard rather than a DOM diff.

  **None of this is licence to change what is drawn.** The original's own metrics, colours,
  easing and timings stay exactly as they are -- this is about when the browser gets the
  bytes and how often we repaint, not about the appearance. The before and after numbers
  are in `comparisons/loading-evidence.md`.

- **The map flashes in at game start -- preload it.** Starting a match swaps to the game
  page and the map pops in a moment later. `BonkApp.preload()` (`client/app.js:12-21`)
  already warms the page itself: an offscreen `game.html?preload=1` fetches and compiles
  the scripts, the fonts and the WebGL context ahead of the swap. What it cannot warm is
  the **map**, because the warm copy deliberately opens no socket -- `game.html`'s inline
  script hands it an inert `io()` so it takes no seat in a room -- and with no socket it
  never receives one. So the real page still arrives knowing nothing, connects, is told
  the map, builds the physics and only then draws. That gap is the flash.

  The map is already known before the swap. `lobbyState` carries `mapPhysics`, and
  `drawLobbyMap` renders a thumbnail straight from it, so the lobby is holding the data
  the game page is about to wait for. The shape of the fix is to hand it over -- warm the
  map into the preload frame, or stash it for the game page to read on boot -- and to
  hold the first paint until there is something real to paint, rather than painting empty
  and correcting. Quick play has no lobby to carry it, so that path needs its own answer.

  **Not licence to change what is drawn.** Same rule as the item above: this is about when
  the bytes and the physics arrive, not what the map looks like. Measure the swap before
  and after and put the numbers in `comparisons/loading-evidence.md`.

## Larger features not started

- **Replay recording and playback.** The `pretty_top_replay` button exists in
  `client/game.html` and `client/menu.html` with a placeholder title and no handler.

  The menu background is the only replay this build has, and two faults in it are fixed:
  it showed the one map picked at boot every time, and it inherited that round's 90-frame
  freeze, so the menu opened on a still image for three seconds. It now walks the session
  map order and is never frozen. When real replays are built they keep both rules: a
  replay is tied to **its own map**, and frozen frames are not part of it.
- **Map database window**: the level browser, with PICKS, search and favourites. This is
  also what the **map button popup should be**: today that button opens this build's own
  `localLobbyMapWindow`, a plain list of `name — author` buttons that is not the
  original's UI at all (see `comparisons/local-20261107-09-nonhost-map-window.png`). The
  original opens `#maploadwindowcontainer`, whose whole layout is already captured in
  `resources/source/css/maploadwindow.css` — 20 elements, including a top bar, a type
  dropdown, a search box with name/author toggles and a sort-by, a "hotness" slider from
  newest to highest rated, a results table and a status line. Replacing the popup with the
  original's is the near half of this item; the database behind it is the far half.
- **Level editor.**

## Modes

- **VTOL** and **Football** are defined in `server.js` with `available: false`. The real lobby
  lists six modes; four work here.

- **Death Arrows arrows need a black outline.** In Death Arrows the arrows carry a black
  outline, which is what sets them apart from the ordinary Arrows mode's. This build
  draws both modes' arrows the same.

  Written down from report, **not yet read out of the bundle** -- so before it is built,
  find where the original draws the arrow and what the outline actually is: its colour,
  its thickness, whether it is a stroke on the existing shape or a separate sprite, and
  whether it applies to the arrow in flight, the one on the bow while drawn, or both.
  `ard` is the mode code (`client/mode-runtime.js:8`), already flagged `deadly: true`.

## Map values that still do nothing

- **Shrinking shapes.** Per-shape `sk` round-trips through `src/map-codec.js` but nothing reads
  it, and the map-level shrink speed `physics.ss` isn't decoded at all.
- **Respawn mode.** `map.s.re` is read and written by the codec and no match logic consumes it.
  (The `re` on fixtures and bodies is restitution, a different field, and that one works.)

## Parity gaps

- **Arrow aim is jittery.** The turn rate itself is right and is not the thing to change:
  the original turns the aim a whole 5 degrees a frame, `round-evidence.md` verified it, and
  `client/mode-runtime.js` steps `disc.da` by `METER.drawTurnStep` to match. What the
  original does on top of that is **smooth the turn**, so the bow sweeps round instead of
  snapping between 5-degree positions the way this build's does — the simulation runs at 30
  frames a second and the bow is drawn straight off `disc.da`, so every display frame
  between two steps shows the same angle and the aim visibly stutters.

  So: keep the stepped 5 degrees as the aim the simulation and the shot use, and smooth what
  is *drawn*. How the original smooths it has to be read out of the bundle, not guessed —
  whether the drawn angle eases toward the stepped one or is interpolated between the last
  two, and over how long. Do not replace the 5-degree step with a smaller one to make it look
  smoother; that would change where arrows actually go.

- **Spawn assignment.** The original adds a seeded random fraction to each spawn's priority and
  hands spawns out using the game seed. This build sorts by priority and takes players in
  order, with `seed: 87` hardcoded in `src/maps.js`. With more than one player the starting
  positions aren't the original's.

## Other things

- When ur shooting arrows, don't allow moving with w or s (up or down) actually. You can only bounce with w but you cannot hold them. Allow jumping basically, but don't allow holding up or down. This is EXACTLY like bonk.io, correct me or this if I'm wrong.
- Heavy saturation or strength should be independent of ability cooldowns. Like bonk.io (there's always a chance I'm wrong). Heavy strength is at 100% at game start, then if you use it you make it weaker (or less bright, more saturated) and if you stop using it it becomes stronger. The strength is like ability, the min strength max strength brightnesses. Like that. I might be wrong. Again, check real bonk.io for confirmation.
- **Exit game confirmation buttons were purplish. Done, checked against the live site.**
  They computed `rgb(92, 45, 52)` = `#5c2d34`, which is the bare `.brownButton` in the
  original's `pagelayout.css` -- the rule whose own comment calls it "red". Every other
  button in this build also carries `brownButton_classic`, which `classicactive.css`
  overrides to `#795548`; the two in the Leave Game window were the only ones without it.

  Rather than assume that was the difference, bonk.io itself was read: both windows are in
  the live `gameframe-release.html` from page load, hidden, and its own markup is

  ```html
  <div id="leaveconfirmwindow_cancelbutton" class="brownButton brownButton_classic buttonShadow">Cancel</div>
  <div id="leaveconfirmwindow_okbutton" class="brownButton brownButton_classic buttonShadow">Ok</div>
  ```

  computing `rgb(121, 85, 72)`. This build now carries the same class and computes the same
  colour, and a test fails if it comes off again. `comparisons/official-leave-window.png`
  and `comparisons/local-leave-window.png` are the two windows side by side; the numbers and
  the rest of the capture are in `comparisons/exit-evidence.md`.

- **Picked map doesn't work in custom games. Done.** The lobby did set the host's pick --
  the preview, the name and the author all came from it -- and the game start then threw it
  away: it rebuilt the room's state from the session's shuffled map order, which is right
  for Quick Play and has no business in a room with a lobby. Only Quick Play walks that
  order now. Measured in the browser: picking pool index 0 used to open the game on "Fan"
  (index 35) and now opens it on the map that was picked. See
  `comparisons/map-selection-evidence.md`.

- **New rounds reset the map. Done.** Quick Play always rebuilt the map each round, because
  it changes map each round; a custom game kept one map and nothing put it back, so a round
  opened on platforms the round before had shoved out of place, swings already moving and
  cap zones part claimed. Every body's position, angle and velocity is written into
  `state.physics` each frame, so the fix is to lay the map out again from the pool's own
  copy -- the same call quick play's rotation uses, with the map the state already names.
  The discs' spawns are deliberately left alone: it is the same map, and they carry the
  team flags that assigned them.

  Measured on a map with six sliders: all six drifted during round 0 and all six read their
  opening positions again at the start of round 1. **That the original does this was not
  read out of the bundle** -- it is what this item asked for and the only thing consistent
  with the round reset already here, and `comparisons/map-selection-evidence.md` records it
  as unread rather than verified.

  Still open: a map from the level editor or the map database has no pool index to name, so
  neither path reaches it yet.

- **Join / leave messages on the way out of a game. Done.** The original's lobby and game
  are one page, so nobody is ever announced twice; here they are two, and every player
  returning from a game connected as a brand new lobby socket. The room announced each of
  them, so a game handed back opened on a column of "has joined the game". The two places
  that cause the handoff now name the players they expect to see again and those lines are
  not raised, while anyone genuinely arriving in the meantime still is. See section 8 of
  `comparisons/lobby-evidence.md`.

  Still open there, and written up with it: the chat **log** does not survive the handoff
  either. The lobby page is loaded fresh, so everything said before the game is gone, where
  the original simply still has it. That needs the server to keep a per-room log and replay
  it to a lobby socket as it connects.
- In quickplay make it so that players need to WAIT until the current game is over the joining hte NEXT round rather than immediately going in in quickplay.

## Stale evidence

Done. Both files now carry a banner saying what date they describe, a table of which later
evidence file overtook each wrong claim, and what is still genuinely open in them. Their
original measurements were left in place as the historical record rather than rewritten,
since re-asserting them would need fresh capture.
