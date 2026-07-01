# FIRE FIGHT 🔥🥊

Bare-knuckle boxing at a distance, in WebXR passthrough. Two flaming iron
balls orbit your fists — **hold the trigger** and a ball roars in orbit around
your hand, **whip a punch and release** to hurl it at your opponent, **pull
the trigger again** to call it blazing back to your palm. A recalled ball
that passes **through** your opponent (or a training target) on its way home
still counts as a hit — recalling through them is a real technique. Your
orbiting ball is also your shield: it parries incoming fire out of the air.

The look is industrial future fight club — 90s UK robot-wars: gunmetal
plate, hazard-amber striping, riveted smoked-glass UI you can see your room
through, shoulder-heavy mech avatars and chunky mechanical gauntlets, with a
synthesised metal-on-metal soundscape (servos, pistons, anvil clangs). An
invisible cage stands ~10 yards out from each platform on every side; stray
fire bursts against it instead of sailing off into your house, and every
ball drags a thick FlamethrowerXR comet trail.

Built on Meta's [Immersive Web SDK](https://iwsdk.dev/) (Three.js + ECS).
Play space dimensions follow Blaston's layout — two octagonal platforms
(~1.72 × 1.5 m) facing each other — pulled slightly closer (3.4 m) for that
in-your-face boxing feel.

## Modes

- **AIM TRAINING** — the heart of the game. Bullseye discs and humanoid
  cutouts pop up across the gap; land your fire while they're up. Streaks
  multiply your score and the cadence ramps. Flip **targets shoot back** on
  and the cutouts return blue fire so you train dodging between throws. In
  the **last 30 seconds**, gold **octa drones** join the mix — small spinning
  octagon plates (pub octa-hunt style) that strafe their lane, demand a led
  shot and pay 300 a pop.
- **VS BOT** — spar an iron boxer that strafes, ducks, reactively dodges your
  throws and hurls fire back on a cadence.
- **1V1 QUICK MATCH** — competitive online duels through the bundled relay
  server. Best of 5 rounds, 60 s each, knockout or higher health at the bell.
  P2P matches carry **directional voice chat**: your rival's mic is
  spatialised onto their avatar's head (HRTF), so their trash talk pans and
  ducks with them. Mic permission is asked when you queue; declining still
  lets you hear them.
- **ARCADE** — the titan gauntlet, on the console below the training panel.
  The CAMPAIGN plate opens the **titan line-up**: five boss cards left to
  right, each wearing its own hand-drawn icon (hook, piston, crosshair,
  shield, crown) — you fight them in order, and after every bout (the
  collapse, the fanfare) you land back on this line-up. Five boss machines,
  each bigger than the last (~2.3 m up to ~6 m of plate), each with its own
  elaborate pit-lane intro: klaxon, strobes, the titan grinding up out of
  the floor, name card, roar, bell. Titans never throw balls — they wind up
  **melee and ranged strikes whose kill zones charge up visibly on YOUR
  platform** (fist-slam discs, duck-under sweep blades, eye beam strips,
  mortar barrages). Their armour clanks your fire away; damage goes in
  through the **visor**, the pauldron **pods** while a barrage cooks, and —
  for double — the chest **core** that vents open after every melee swing.
  Dodge, then punish: David vs Goliath, souls-style. Wins pay SCRAP + XP
  like any bout; the **first fell of each titan pays double** — and the
  first fell of GOLIATH awards the gold **CHAMPION platform**, equippable
  from the LOADOUT row on the line-up.

  **Every titan is a different fight**: RUSTHOOK's slam crater detonates
  *twice* (patience); PISTONKAISER's slams march across the platform on a
  three-beat drumline (rhythm); WIDOWMAKER's beam *tracks you* and only
  locks late (dodge late, not early); JUGGERNAUT's mortars leave **burning
  floor patches** that shrink your footing (the ground war); GOLIATH does
  all of it and **enrages at half health**.

  Fell all five and the line-up's **LEADERBOARD** panel opens **THE
  GAUNTLET RUN**: all five titans back to back with condensed intros, your
  health refit between bouts, on a clock that only counts fight time — beat
  the run and your time goes on the board. Completing your first gauntlet
  unlocks **HARDCORE**: the same run with no healing between titans, on its
  own leaderboard.

## The rules of the platform

You see your platform beneath you — and its **rim barrier**. Guardian-style
walls glow awake as your head nears the edge; lean your head out past the rim
and the arena's fire drains your health *fast*. Dodge with your body, but stay
on your platform.

Match UI is arena-style: angled neon scoreboards flank the gap (your board
orange, theirs blue) with big health bars, round pips and the timer, plus a
stats board hung behind you that you can glance back at mid-bout.

## Run it

```bash
npm install
npm run dev        # client on https://localhost:5173 (IWSDK desktop emulator included)
npm run server     # optional: the 1v1 relay on :8787
```

On a Quest, open the dev URL in the headset browser and accept the "Enter AR"
offer. On desktop, the IWSDK dev plugin provides a WebXR emulator
(WASD + mouse, controller simulation).

### Online play

Two transports, one protocol — `src/net/` picks automatically:

1. **Serverless (default)** — Firebase Firestore handles matchmaking + WebRTC
   signaling (the repurposed `arfi-b68f9` project, see
   `src/net/firebaseConfig.ts`), then ALL game traffic flows **peer-to-peer
   over RTCDataChannels**: poses on an unordered/no-retransmit channel,
   events on a reliable one. Firebase never sees a pose packet — that's the
   latency upgrade over relaying game state through a realtime database.
   One-time setup in the [Firebase console](https://console.firebase.google.com/project/arfi-b68f9):
   enable **Cloud Firestore** and allow read/write on the `lobbies`
   collection (rules sketch in `firebaseConfig.ts`).
2. **WebSocket relay** — `npm run server` (~100 lines, zero game logic) and
   point clients at it with `?server=wss://your-relay-host:8787`. Lowest
   latency when hosted near both players; also the LAN/dev fallback.

`?net=p2p` / `?net=ws` force a transport. Netcode in both cases: each client
is **authoritative for hits against itself** (dodge-fair under latency), the
host client owns match state and echoes it, poses stream at 20 Hz with
exponential smoothing, and all coordinates are mirrored across the arena
(`(x,y,z) → (-x, y, -z-3.4)`, 180° yaw) so both players stand at their own
world origin.

## Controls

| Input | Action |
| --- | --- |
| Hold trigger | Ball orbits that fist (spins up over ~1 s) |
| Release mid-punch | Throw — speed and direction follow your swing |
| Trigger (ball away) | Recall the ball to that fist |
| Recall through a body/target | Counts as a hit (once per recall) |
| Your orbit/recall path | Parries enemy balls on contact |
| Head past the rim | Rapid health drain — get back on the platform |

## Project shape

```
src/
  config.ts            every gameplay tunable, documented
  components/          ECS components (Fireball, Hitbox, TrainingTarget, …)
  systems/             FireballSystem (the state machine), Collision,
                       Boundary, Bot, Network, Training, GameState, Menu, FX…
  fx/fire.ts           the ported FlamethrowerXR fire: simplex-noise molten
                       core + additive corona shaders, GPU ember/trail pools
  avatar/boxer.ts      head + IK torso + floating gloves (no legs — on brand)
  net/                 protocol + relay client (frame-synced inbox)
  ui/scoreboard.ts     arena-style flanking health boards + back stats board
server/index.mjs       the relay
```

Lineage: forked gameplay skeleton from `yellkell/glasston` (Blaston-style
play space, IK body hitboxes, match flow) and the fire rendering from
`yellkell/flamethrowerxr`, rebuilt into one game.
