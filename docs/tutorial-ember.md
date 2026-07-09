# EMBER — the voiced tutorial

A rework of the tutorial around a voiced guide: **Ember**, a female glowing
ball of light (think Navi, if Navi were a foundry spark with good manners).
She catches your eye, teaches the basics the game already has — but properly:
she *waits* for a real block, throws more balls if you need them — then opens
the ball loadout and lets you test attachments on the bot before the
graduation fight. The script is thick with "good job" and "well done" on
purpose; that's the brief.

This doc is three things:

1. **The character** — casting + read direction for the voice actor.
2. **The choreography** — beat-by-beat sequence with the exact engine hooks
   (what the orb does, what we wait for, what happens on failure).
3. **The complete recording script** — every line, with ID, trigger, and
   per-line direction. Line IDs are the asset filenames
   (`src/assets/tutor/<id>.mp3`), loaded the same way `src/audio/announcer.ts`
   loads the announcer.

---

## 1. The character

**EMBER** — the last spark of the old Gasket foundry. A fist-sized ball of
warm golden-orange light that bobs, darts, and flares with her mood. She has
adopted the player on sight.

- **Voice**: female, bright, mid-20s energy, a tiny crackle/rasp is a bonus
  (she is literally a spark). Warm coach, not drill sergeant, not babysitter.
- **Loves**: teaching Clankers to throw fire, the sound a blocked shot makes,
  the player.
- **Never**: sarcastic at the player's expense, bored, monotone. When the
  player fails she gets *more* invested, not less.
- **Excitement scales with the player.** Small win → warm. First block →
  delighted. Attachment goes off → loses her mind a little.
- **In-world texture**: she calls the player *slugger* and (affectionately)
  *Clanker*; she thinks Sheriff Cole Ironside is wrong about Clankers and
  says so once.

### Recording / delivery spec

- One file per line, named exactly by the **ID** column below
  (e.g. `e012-found-you.wav`). We transcode to mp3 into `src/assets/tutor/`.
- 48 kHz mono WAV, dry (no reverb — spatialisation happens in-engine via the
  HRTF panner so her voice comes *from the orb*).
- 2–3 takes per line; for the praise pool (E-100s) give us as much variety of
  read as possible — they rotate at random and must not sound canned.
- Lines marked *(giggle)* / *(gasp)* etc.: perform the direction, don't say it.
- Keep pace conversational; every line plays over live gameplay, and any new
  line hard-stops the current one, so no line needs to rush.

---

## 2. Choreography

### The orb itself

Built and owned by `TutorialSystem` (which already owns scene objects — the
popup and pointer lines — and disposes them in `end()`).

- **Body**: `glowSprite(0xffc04d, 0.16)` (`src/materials/glow.ts:37`) with a
  second, smaller white-hot core sprite; `spawnEmber(orbPos, up, 0.4)` on a
  ~0.12 s accumulator while moving (pool in `src/fx/fire.ts:317`).
- **Motion**: target-position + critically-damped lerp in
  `TutorialSystem.update(delta)`; idle bob = `sin(this.time * 2.2) * 0.03` on
  Y; she **pulses ~15 % brighter in time with her own voice** (drive scale off
  an `AnalyserNode` on her gain, or a simple envelope while a line plays).
- **Voice**: new `src/audio/tutorVoice.ts`, cloned from `announcer.ts`
  (`import.meta.glob('../assets/tutor/*.mp3')` → decode → `BufferSource` →
  gain 0.9 → **HRTF `PannerNode`** positioned at the orb each frame — same
  graph as `src/pub/voice/playback.ts` → `sfxOut()` so she rides the SFX
  fader). Keep the current source node so a new line can `.stop()` the old.
- **Captions**: the existing popup plate (`makePopup()` pattern) shrinks into
  a small subtitle plate that follows 0.35 m under the orb and mirrors the
  spoken line — accessibility, and it replaces the old lesson cards.
- **Interaction**: "punch me" detection = either grip within 0.25 m of the orb
  while `VelocityTracker` speed > 1.0 m/s. Gaze detection = head-forward ·
  (orb − head) normalised > 0.92 held 0.5 s.

### Global rules (all beats)

- Tutorial still rides the ordinary vs-bot bout (`start-tutorial` in
  `MenuSystem.ts:531`), `suppressBot()` + `pinHealth()` + round-timer top-up
  stay exactly as they are. `app.tutorialHoldFire` is only true during beats
  0–1.
- **Praise pool**: every success plays its scripted success line; *repeat*
  successes (retries, extra attachment tests) draw from the E-100 pool,
  never repeating the last one picked.
- **Idle nudge**: any WAIT that sits 14 s replays the beat's explain line,
  then E-110 at 30 s. Never punishes, never times out.
- Any line interrupts the current line. Reactive fight lines (E-092–095) each
  fire at most once.

### Beat 0 — ATTENTION *(the hook — `app.tutorialHoldFire = true`)*

Arena fades in. Tutorial music low. **Ember does not start in front of you.**

1. Orb spawns dim and small ~2.5 m out at the player's **10 o'clock**, just
   inside peripheral vision. Soft chime (`sfx` two-note `tone()`). She plays
   **E-010** ("Psst.") — quiet, spatialised, off to the side.
2. She drifts across the periphery, left → right, trailing embers — motion is
   what the eye catches. WAIT for **gaze** (0.92 dot, 0.5 s).
3. **If no gaze after 4 s**: she darts in and orbits the player's head once,
   1 m radius, chiming, plays **E-011** ("Hey! Hey — over here!").
4. **If still no gaze after a second orbit**: she gives up being coy, parks at
   eye height 1.4 m dead ahead, flares bright.
5. On gaze (or forced park): happy double-bounce, flare, **E-012 → E-013 →
   E-014** (found-you, name, job). She's on stage; the tutorial proper begins.

### Beat 1 — SETUP

1. **E-020**: clear a space. The orb dives to the floor and **traces the
   1.8 m × 1.8 m play square with an ember trail** (one lap, ~2.5 s), then
   pops back up. **E-021** re-centre note.
2. **E-022**: "punch me." She parks at chest height, 0.6 m out, bobbing —
   *she is the ready button now* (replaces the old canvas `READY_BTN`).
3. WAIT: punch-through detection. On idle → **E-024** nudge.
4. On punch: she ricochets back a metre with a *(giggle)* burst of embers,
   **E-023**. `app.tutorialHoldFire = false`. Haptic pulse on the punching
   hand.

### Beat 2 — IGNITE

1. Orb flies down and **circles the player's dominant fist twice**, tracing
   the orbit path a ball will take. **E-030**.
2. WAIT: `playerBallIn(BallState.Orbit)` (existing `TutorialSystem.ts:393`
   poll).
3. Retry: 10 s without a spin-up → **E-033** ("hold, don't tap") + haptic tap
   on that hand, orb taps the fist.
4. On success: she recoils in mock awe, **E-031 → E-032**.

### Beat 3 — THROW

1. Orb zips downrange and **hovers over the bot's head, bobbing like a target
   marker**. **E-040**, then **E-041** from over there — her voice being
   spatial is the aim cue.
2. WAIT: `playerBallIn(BallState.Flying)`.
3. Retries: release below `FIREBALL.minPunchSpeed` (1.1 m/s — detectable as
   trigger-up while orbiting with tracker speed under threshold) → **E-044**
   ("too gentle"). Any other 12 s stall → **E-045**.
4. On success: **E-042**; if the throw actually connects
   (`resolveLocalHit`, `CollisionSystem.ts:196`) stack **E-043** on top.

### Beat 4 — RECALL

1. Orb returns to the player's shoulder. **E-050**.
2. WAIT: `playerBallIn(BallState.Returning)` → she calls **E-051**
   mid-flight; then WAIT for the catch (ball reverts within
   `FIREBALL.catchRadius` — poll: player ball back in `Hover`).
3. Retry: 10 s → **E-053**.
4. On catch: **E-052**.

### Beat 5 — BLOCK *(the real one — waits for an actual parry, throws more balls as needed)*

The old step just ran a 3 s timer. Now we verify a **real deflect**:
tag the entity of each ball we lob; add a tutorial-readable deflect counter
bumped in `CollisionSystem.tryParry()` (`CollisionSystem.ts:326`) when the
spent ball is the tagged one. Outcomes per lobbed ball: **blocked** (counter
bumped), **hit** (`feedback.playerHitFlash` fired while tagged ball live), or
**missed/expired** (tagged ball died with neither).

1. Orb takes a bodyguard post just off the player's lead shoulder. **E-060**
   (spinning ball = shield), **E-061** (spin up, he's going to throw).
2. WAIT: player has an `Orbit` ball (she won't let the bot throw until the
   shield exists — same guard as today's `tickBlock()`).
3. Lob ball #1: `ballCommands.push({type:'throw', ...})` at **2.4 m/s**
   (slower than the old 3.0), aimed mid-chest. As it leaves the bot's hand:
   **E-062** ("Incoming!").
4. Resolve:
   - **Blocked** → flare + ember burst at the parry point, **E-063**.
   - **Hit** → **E-064** (sympathetic, never scolding), wait for shield, lob
     again at **2.1 m/s** (easier).
   - **Miss** → **E-065**, lob again at 2.4 m/s.
   - Three consecutive non-blocks → **E-068** (the calm reset read), then
     keep lobbing at 2.1 m/s. **There is no failure exit; she throws balls
     until the player blocks one.** Repeat prompts pull from the praise/nudge
     pools so nothing loops verbatim.
5. **Confirmation rep**: after the first block, **E-066** ("one more, a
   little quicker") — lob at **3.2 m/s**. Blocked → **E-067** ("two for
   two"). If this faster one gets through, no reset — drop back to 2.4 m/s
   with a pool nudge until she gets her second block.

### Beat 6 — DODGE *(same wait-for-real-success treatment)*

Success = tagged ball crosses the player's plane with **no** hit flash AND
head moved > 0.3 m horizontally from its position at the moment of the throw
(upgrade of the existing `move` check, `TutorialSystem.ts:301`).

1. Orb sweeps out wide to the player's flank — physically showing the
   off-line direction. **E-070**.
2. Lob at the **head**, 2.6 m/s. At release: **E-071** ("MOVE!").
3. Hit → **E-073**, throw again (2.3 m/s). Stood still and got lucky (ball
   missed but head never moved) → treat as miss, pool nudge, again.
4. Success → **E-072**, and if it was a clean big step, **E-074** (the
   Sheriff joke — fire at most once).

### Beat 7 — ATTACHMENTS *(new content: loadout panel in-arena + live test on the bot)*

1. **E-080** — orb flies to a spot 1.2 m to the player's right and *waits for
   them to come look*, pulsing.
2. The **BALL LOADOUT** panel materialises where she's hovering — reuse the
   `'balls'` panel drawing + `clickBalls()` hit-test from
   `src/menu/menu.ts:1181` on a tutorial-owned plane, lasers re-enabled for
   it (TutorialSystem already owns pointer lines). **E-081**, then **E-082**
   — as she names SPLIT / GROW / SHRINK / CURVE she **hops to each row** of
   the panel in time with the line.
3. **E-083** — WAIT: any change to `app.ballAttach` (or `app.ballArc`). On
   equip: **E-084**.
4. **E-085** — test it. Orb takes her target post over the bot again. WAIT:
   a player ball goes `Flying` → `Returning` with `attach != none`
   (`applyAttachment`, `FireballSystem.ts:189`) — i.e. the effect actually
   triggered. Recall-after-landing → **E-088** ("while it's still flying").
5. Effect fires → **E-086** (her biggest reaction in the whole script;
   split shards especially). Then **E-087**: free-play — she waits, praise
   pool on each further test, and the exit is the same *punch-me* gesture
   from Beat 1. Panel folds away when punched.

### Beat 8 — GRADUATION FIGHT

1. Orb rises to centre stage. **E-090** (the proud one) → **E-091**
   (beat him). She zips up to a **corner perch** above the arena and dims to
   a spark — visible, out of the way.
2. Bot un-suppressed, HP still capped at `TUT_BOT_HP = 55`. Reactive
   one-shots from the perch (each once): first hit landed → **E-092**; first
   parry → **E-093**; first time hit → **E-094**; bot under 15 HP →
   **E-095**.
3. **Win** → she dives from the perch and **spirals around the player**,
   ember-bursting: **E-096 → E-097** (outro), then the normal
   return-to-menu.
4. **Loss** → she's at the player's side instantly, soft: **E-098**. Menu.
   (Retry stays one lobby click away; she never makes losing feel like an
   ending.)

---

## 3. The complete recording script

~46 numbered lines + pools. **Bold** in the line text = punch the word.
Stage directions in *(italics)* are performed, not spoken.

### Beat 0 — Attention

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e010-psst` | "Psst." | Whisper, conspiratorial, smiling. | Orb spawns at 10 o'clock. |
| `e011-hey-over-here` | "Hey! Hey — over here!" | Bright, playful; louder than E-010 but not shouting. | 4 s without gaze; orbiting player's head. |
| `e012-found-you` | *(delighted gasp)* "There you are! Hi! Down here — the floating light? That's me." | Charmed, a little breathless. She's been waiting all day for this. | Gaze lands on her. |
| `e013-intro-name` | "I'm **Ember**. Last spark of the old Gasket foundry. Guide, coach, and — as of about four seconds ago — your **biggest fan**." | Warm intro, tiny flourish on "biggest fan". | Follows E-012. |
| `e014-intro-job` | "You're here to learn fire-fighting. Lucky for you — teaching Clankers to throw fire is my **favourite thing in the whole world**." | Genuine relish. Set the tone for the next ten minutes. | Follows E-013. |

### Beat 1 — Setup

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e020-setup-space` | "First things first: clear yourself some room. A big square — two paces each side. Go on, I'll trace it for you." | Practical but chirpy; she dives floorward on the last phrase. | Beat start; orb traces the play square. |
| `e021-setup-recentre` | "If you ever drift, you can re-centre your space with your controller. Okay!" | Quick aside, then a bright "Okay!" to turn the page. | After the floor trace. |
| `e022-setup-punch-me` | "Ready? Then **punch me**. Right through me — I'm made of light, it tickles." | Grinning dare. | Orb parks at chest height. |
| `e023-setup-punched` | *(giggle)* "Ha! **Good arm.** Okay — let's make some fire." | Ricocheting backwards, thrilled. | Player punches through her. |
| `e024-setup-nudge` | "Don't be shy — swing right through me. You **can't** hurt me, promise." | Gentle tease, zero impatience. | 14 s idle on the punch-me wait. |

### Beat 2 — Ignite

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e030-ignite-explain` | "Watch your fist. **Hold** the trigger — and keep holding. Feel that? You're spinning up a fireball." | Hushed, leaning-in, like showing someone a magic trick. | Orb circles the player's fist. |
| `e031-ignite-success` | "**There it is!** Look at that — your very first ball. Ohh, she's a beauty." | Recoiling in mock awe; real warmth on the last phrase. | Ball reaches Orbit. |
| `e032-ignite-praise` | "**Well done.** Most Clankers flinch the first time. You didn't even blink." | Proud, softer — an aside just for them. | Follows E-031. |
| `e033-ignite-retry` | "Hold the trigger down — don't tap it, **hold** it. It needs a second to catch." | Patient, clear, slower on "hold". | 10 s without a spin-up. |

### Beat 3 — Throw

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e040-throw-explain` | "Now the fun part. See the big fella over there? **Punch** towards him — and let go of the trigger at the end of the swing." | Conspiratorial glee. | Beat start. |
| `e041-throw-target` | "Right here! Put it **right where I'm floating!**" | Called from downrange — she's the target marker, waving. | Orb reaches the bot's head. |
| `e042-throw-success` | "**YES!** Ha-HA! **Beautiful** throw! Did you see him rattle?" | Full celebration, laugh in the middle is real. | Ball goes Flying. |
| `e043-throw-praise` | "Good job, slugger. **Really** good." | Comes down from E-042; sincere, smiling. | The throw connected with the bot. |
| `e044-throw-too-soft` | "Almost! You let go too gently. **Really punch** — snap your arm out like you mean it." | Coaching, upbeat; punch the word "punch". | Release under min punch speed. |
| `e045-throw-retry` | "One more. Big swing, let go at the end. **You've got this.**" | Steady confidence. | 12 s stall on the throw wait. |

### Beat 4 — Recall

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e050-recall-explain` | "Now — your ball's just lying out there, and littering is a **crime** in Gasket. Pull the trigger again to call it home." | Mock-stern on "crime", then breezy. | Beat start. |
| `e051-recall-coming` | "Here it comes — hand out, **catch it!**" | Quick, urgent-happy, timed to the return flight. | Ball goes Returning. |
| `e052-recall-success` | "**Caught it!** Oh, **well done**. Throw, recall, catch — that's the heartbeat of everything, right there." | Delight settling into something almost proud-parental. | Clean catch. |
| `e053-recall-retry` | "Tap the trigger — the ball hears you, I promise. It'll come flying back." | Reassuring, a smile in it. | 10 s stall. |

### Beat 5 — Block

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e060-block-explain` | "Now listen close, because **this one keeps you alive**. A spinning ball isn't just a weapon — it's a **shield**. Anything that hits it fizzles out." | Drop the bounce; sincere and steady. The one serious read in the script. | Beat start; orb at the player's shoulder. |
| `e061-block-setup` | "Spin up a ball and hold it near your chest. He's going to throw at you — nice and slow. Don't worry, I told him to be **gentle**." | Calm, wink on "gentle". | Follows E-060. |
| `e062-block-incoming` | "**Incoming!** Get that ball in the way!" | Sharp call, not panicked. | Bot's lob leaves his hand. |
| `e063-block-success` | "**WELL DONE!** You blocked it! Hear that clang? That's the sound of **not getting hit**." | Explosive relief and joy. | Real parry on the lobbed ball. |
| `e064-block-hit` | "Oof! You okay? Hey — happens to **everyone**. Ball up, keep it between you and him. Again!" | Sympathy first, zero blame, quick pivot to energy. | Lobbed ball hit the player. |
| `e065-block-miss` | "**Nearly!** The ball has to touch the shot. Keep it right in front of your chest — here comes another." | Encouraging, matter-of-fact. | Lob expired unblocked, player untouched. |
| `e066-block-again-faster` | "Perfect. Now one more, a **little quicker** this time. Show me it wasn't luck." | Sly grin, throwing down a friendly gauntlet. | After first successful block. |
| `e067-block-second-success` | "**THAT'S IT!** Two for two! Oh, you're a **natural** — you know that?" | Even bigger than E-063. She means it. | Second (faster) block lands. |
| `e068-block-encourage` | "You're **so close**. Watch the ball leave his hand… and just put your shield on that line. Deep breath. Again." | Slow, warm, steadying — the arm-around-the-shoulder read. | Three consecutive non-blocks. |

### Beat 6 — Dodge

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e070-dodge-explain` | "Blocking's good. **Not being there at all?** Even better. This time when he throws — **move**. Step, lean, duck. Whole body." | Bright, kinetic; she's sweeping sideways as she says it. | Beat start. |
| `e071-dodge-incoming` | "Here it comes — **MOVE!**" | Sharp and fun, like a skipping-rope call. | Head-height lob released. |
| `e072-dodge-success` | "Ha! It didn't even **touch** you! Good job — you move well for a big lump of iron." | Laughing, affectionate on the tease. | Ball crossed clean + head moved. |
| `e073-dodge-hit` | "Ooh — right in the boiler. You've got to **really** step. Big step, whole body, off the line. Ready? Again." | Wince, then coach-reset. Never annoyed. | Lob hit the player. |
| `e074-dodge-praise` | "**Lovely** footwork. The Sheriff says Clankers can't dance. The Sheriff is **wrong**." | Deadpan on the last sentence — her one bit of politics. | Clean, big-step dodge (fires once ever). |

### Beat 7 — Attachments

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e080-attach-intro` | "Okay. You can throw, catch, block, and dodge. So now… **my favourite part.** Come look at this." | Giddy secret; she's already flying off on "come look". | Beat start. |
| `e081-attach-panel` | "This is your **ball loadout**. Attachments — they change what your ball does when you recall it **mid-flight**." | Show-woman reveal as the panel materialises. | Panel appears at the orb. |
| `e082-attach-explain` | "**SPLIT** breaks it into three on the way home. **GROW** makes it big and mean. **SHRINK** makes it small and spiteful. And **CURVE** bends your throws right around their guard." | Rhythmic, relishing each name — she hops row to row in time. | Follows E-081; keep the four names evenly paced for the hop sync. |
| `e083-attach-equip` | "Pick one for a fist — go on, tap it. You can swap these any time, even back in the lobby." | Easy, no pressure. | Follows E-082. |
| `e084-attach-equipped` | "Ooh — **good choice.** Alright: let's test it on him." | Approving purr, then mischief. | `app.ballAttach` / `ballArc` changes. |
| `e085-attach-test` | "Throw at him — and while the ball's **still flying**, pull the trigger to recall. Watch what happens on the way back." | Set-up read; lean on "still flying", it's the whole lesson. | Orb back on target post. |
| `e086-attach-success` | *(gasp)* "**HA! Did you SEE that?!** Oh, I never get tired of that one. **Well done!**" | Her single biggest reaction in the script. Unhinged delight, within reason. | Attachment effect triggers mid-flight. |
| `e087-attach-more` | "Try the others if you like — I'm in no hurry. Punch me when you're ready to move on." | Relaxed, indulgent; the punch-me callback should sound fond. | Follows E-086; free-play begins. |
| `e088-attach-retry` | "Timing's everything — recall while it's **still in the air**, not after it lands." | Helpful, precise. | Recall happened after the ball landed. |

### Beat 8 — Graduation

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e090-grad-ready` | "That's it. That's everything I've got. You came in here a shiny lump of parts… **look at you now.**" | The proud one. Take your time; let the ellipsis breathe. | Player punches out of free-play. |
| `e091-grad-fight` | "One last thing: **him**. Knock him down and you're done. I'll be right up here — **make me proud, slugger!**" | Builds from calm to a rallying send-off; she's rising to her perch on the last phrase. | Follows E-090; fight begins. |
| `e092-fight-first-hit` | "**There it is!** Keep swinging!" | Quick bark from the perch. | First hit landed (once). |
| `e093-fight-first-block` | "**Well blocked!** You WERE listening!" | Delighted, teasing. | First parry in the fight (once). |
| `e094-fight-player-hit` | "Shake it off — you're **iron**, remember?" | Warm, steadying, quick. | First time the player is hit (once). |
| `e095-fight-bot-low` | "He's **wobbling** — finish it!" | Urgent glee. | Bot under 15 HP (once). |
| `e096-win` | "**YOU DID IT!** Down goes the big fella! Oh, **well done, well done, WELL DONE!**" | Total eruption; the three "well done"s each bigger than the last. | Bot KO'd. |
| `e097-win-outro` | "That's **my** Clanker. Go on — Gasket's waiting for you. And hey… come visit me sometime, alright?" | Comes all the way down: proud, fond, a little wistful on the last line. | Follows E-096; return to menu after. |
| `e098-lose` | "Hey, hey — up you get. He's been doing this for **years**; you've been at it ten minutes. Rest that chassis and come back swinging, alright? **I'll be here.**" | Soft, kind, certain. No pity. The promise at the end is the hook to retry. | Player KO'd. |

### Praise pool (E-100s) — rotate at random, never repeat the last pick

Used for: repeat successes on retries, extra attachment tests in free-play,
any small win that already had its scripted line. **Record 2–3 distinct
reads of each.**

| ID | Line | Direction |
|---|---|---|
| `e100-praise-good-job` | "Good job!" | Bright and quick. |
| `e101-praise-well-done` | "Well done!" | Warm, punchy. |
| `e102-praise-nice` | "Nice!" | Casual, impressed. |
| `e103-praise-lovely` | "Ohh, **lovely**." | Savouring it. |
| `e104-praise-thats-it` | "**That's it!**" | Coach's snap of recognition. |
| `e105-praise-natural` | "You're a **natural!**" | Half-laughing disbelief. |
| `e106-praise-perfect` | "**Perfect.**" | Quiet and certain. |
| `e107-praise-again` | "Yes! **Again!**" | Momentum-building. |

### Nudge pool (E-110s) — long idles, any beat

| ID | Line | Direction |
|---|---|---|
| `e110-nudge-no-rush` | "Still with me? No rush — whenever you're ready." | Utterly patient; she'd wait all day. |
| `e111-nudge-take-your-time` | "Take your time. The fire's not going anywhere." | Soft, smiling. |
| `e112-nudge-here-if-needed` | "I'll say it again if you like — just keep watching me." | Kind offer, then the beat's explain line replays. |

---

## Engineering summary (delta from today's `TutorialSystem`)

- **Keep**: `start-tutorial` flow, `suppressBot()`, `pinHealth()`,
  round-timer top-up, `TUT_BOT_HP`, `playerBallIn()` polling, knockdown →
  menu exit, tutorial music.
- **Replace**: the six lesson cards + READY button → Ember (orb + spatial
  voice + subtitle plate) and the beat machine above; `blockTimer` survive
  check → real parry detection (tagged ball + deflect counter bumped in
  `tryParry`); `move` check → dodge-a-real-ball check.
- **New**: `src/audio/tutorVoice.ts` (announcer clone + HRTF panner),
  `src/assets/tutor/*.mp3`, orb visual (glowSprite + ember trail), punch-me
  gesture check, in-arena BALL LOADOUT panel reusing the `'balls'` panel
  draw/hit-test, reactive fight one-shots, praise/nudge pools with
  no-repeat-last rotation.
- **Ordering**: TutorialSystem already runs before FireballSystem
  (`main.ts:102`), so its `ballCommands` pushes and `tutorialHoldFire` edits
  land the same frame — no changes needed there.
