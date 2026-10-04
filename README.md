# Swarm QA

**Swarm QA doesn’t just find bugs. It finds where the game isn’t fun.**

This local hackathon prototype runs the **original Football Legends and OvO games** on an agent-controlled clock. Agents inspect the game, choose inputs, and advance an explicit number of native frames. The home page opens each game at a separate URL, without the surrounding game portal, ads or analytics.

## Start

Requires Node.js 22+, `curl`, and Chrome or Playwright Chromium.

```sh
npm ci
npm run extract:all
cp .env.example .env
# Sign in to Codex for the default subscription models.
# An OpenAI API key is only needed if selecting an API model. Never commit it.
npm start
```

Open [the home page](http://localhost:4173/), [Football Legends](http://localhost:4173/football-legends), or [OvO](http://localhost:4173/ovo). Use **localhost**: Football Legends' existing host check permits it. The server binds only to `127.0.0.1`.

## Demo flow

Each game URL is a workspace with a game capture, an **Explore gameplay** action, and a list of existing findings. Findings open the original reproduction player:

- [Goal camping enables long-range super shots](http://localhost:4173/football-legends/findings/goal-camping)
- [Wall-jump shortcut bypasses level 9](http://localhost:4173/ovo/findings/left-wall-shortcut)
- [Credits logo unlocks all 52 levels](http://localhost:4173/ovo/findings/credits-unlock) — opens the native credits screen with the manual reproduction instructions.

**Explore** at `/football-legends/explore` and `/ovo/explore` runs ordinary play with two selectable profiles. Beginner reacts to nearby targets with broad movement and basic controls. Experienced anticipates the ball or the next platform, uses shorter corrections, and can combine movement with shooting or use a charged ability. These are explicit player models, with distinct prompts, perception lookahead and action timing; they do not alter scores, physics, bot difficulty or completion rules. Neither profile receives the finding policies or their supplied routes.

Each run starts a fresh Football quick match or OvO level 1. Play continues through goals and forward level transitions for up to 120 half-second intervals (60 seconds of simulated time), or until stopped or the native match ends. Choose **Jev + Luna** for Jev movement decisions with Luna screenshot reviews when needed, or **Luna only** for a screenshot-based Luna decision on every playable move. The same profile, action candidates and timing apply in both modes. The selector stays locked during a run, and the selected `decisionMode` is included in session history and exports. A confidence threshold of 0.75 is a routing heuristic, not a calibrated probability of correct play. Countdown and goal-animation waits are local clock actions, explicitly marked `engineWait`, and excluded from the displayed model decision count.

The live view shows the native score or level, game time and action feed. The last six sessions are retained in this browser when storage is available, with an export containing the profile prompt, native observations, decisions and outcome. Exploration exports and server records use `purpose: "explore"` and `guided: false`; finding reproductions retain their supplied-hypothesis labels. Profiles run one at a time in this demo; the UI does not claim concurrent swarm execution or automatic discovery.

Agent activity sits to the left of the game, with player controls above. Each move shows its model and measured model-request latency in milliseconds or seconds. A Jev → Luna move shows the sum of both calls, including time spent on a failed Jev attempt; native waits say “No model call,” and missing measurements stay unavailable. Game playback and screenshot capture are excluded from this metric. Click a move to inspect its application prompt, structured model response and individual call timings. Luna calls include the exact screenshot already submitted; routine Jev decisions use observations only. Opening details makes no additional model calls or screenshots. Full call details are held separately from session history, bounded to 20 moves and an 8 MiB payload budget, and excluded from browser storage, exports and server run files. Starting another run or leaving the screen (including entering the back/forward cache) clears them and revokes screenshot URLs.

Use `npm run verify:explore` for offline policy checks and browser tests with mocked model replies. `npm run benchmark:explore:football` and `npm run benchmark:explore:ovo` run both profiles with **real provider calls** and save evidence under `evidence/explore-*`. Set `AGENT_DECISIONS`, `AGENT_PROFILE`, and `AGENT_TRIALS` to bound a calibration run. Scores and progression in these runs are observed outcomes, not enforced success rates.

In the final Football calibration, equal **40-second game-time samples** ended at **1–2 for beginner** and **3–1 for experienced**, both at the native `botsSkill: 0.2`. They used 3 and 5 screenshot reviews, respectively, with 14.60 s and 16.13 s of total model-call time. These are one fresh sample per profile, not completed matches or a win-rate estimate; ball trajectories vary. Records are in ignored `evidence/explore-final-football/`.

On OvO, both 40-second samples reached level 2. Beginner repeatedly missed its early gaps; experienced traversed those gaps, used a normal wall jump, and smashed the tutorial platform before missing a later jump. The experienced profile makes more progress but does not reliably finish the whole course. The recorded actions are in `evidence/explore-terrain-ovo/beginner-0.json` and `evidence/explore-complete-ovo/experienced-0.json`. No success or failure is injected into either game.

In another terminal, run `npm run verify` to check both games and generate their home-page preview images. If Chrome is unavailable, run `npx playwright install chromium`. `BROWSER_EXECUTABLE` can select another Chromium binary; `PORT` defaults to 4173. Browser scripts currently target port 4173.

Acquisition downloads the inspected public builds into **ignored `private/` storage**. The repository contains our harness, extraction patches and verification code; it does not distribute game bundles, game art, screenshots or recordings. The MIT license covers the original harness code. Original game ownership and attribution remain with MADPUFFERS and DEDRA GAMES.

## Watch the agents

Set these values in the ignored `.env`, then restart the server:

```dotenv
OPENAI_API_KEY=your-key-here
OPENROUTER_API_KEY=your-key-for-hybrid-mode
FOOTBALL_MODEL=chatgpt-gpt-6-luna-fast
OVO_MODEL=chatgpt-gpt-6-luna-fast
```

The demo uses [`@ljoukov/llm` 9.0.0](https://www.npmjs.com/package/@ljoukov/llm/v/9.0.0). **Run Luna Fast agent** starts Football's native 1v1 quick match using a fireball character against the built-in bot. OvO also defaults to Luna Fast, using the verified wall-jump hint. Both games use your existing local Codex/ChatGPT login and the library’s `-fast` priority route. Set either model to `chatgpt-gpt-6.1-sol-fast` for the stronger fallback. Subscription tokens remain on the server; no cloud keys are needed for this local flow. An existing token provider or Codex proxy can also be configured using the library's documented environment variables. The UI displays the active credential route.

A subsequent Luna subscription run also completed OvO in 18 decisions at 2 Hz (9 s game time, 71.47 s total inference), confirming that Sol is not required for the guided route.

Two Jev strategies are available through [OpenRouter's Decisions API](https://docs.typesafe.ai/concepts/system-one). Local code computes geometry, progress and exact key timing; Jev receives categorical features instead of doing numerical calculations.

- **Jev movement · LLM on demand** starts with the supplied textual hypothesis. Jev chooses actual movement actions from locally prepared candidates. A screenshot goes to Luna only on uncertainty, stalled movement, or unexpected state; no initial or scheduled visual call is required.
- **Jev phase routing · visual checkpoints** starts with a screenshot and Luna Fast plan. Jev chooses `continue`, `change_phase`, or `request_visual_review`, while the local controller supplies each phase's actions. This comparison mode also requests a visual checkpoint every ten routine decisions.

Routine Jev decisions send no screenshots. Its reported confidence must be at least 0.8 to execute an action; this threshold is a demo routing rule, not a calibrated accuracy guarantee. Both modes use supplied strategies and local action controllers, so they are guided reproductions rather than independent exploit discoveries.

Hybrid mode needs `OPENROUTER_API_KEY` in the ignored `.env` in addition to the existing ChatGPT login. **Jev movement** is selected by default when both are configured; otherwise the page selects the visual agent. Both engines retain the 500 ms game-time action interval. **Visual agent** remains available for screenshot-based decisions on every turn; the OvO rehearsal is separately labelled as scripted.

### Measured speed comparison

Fresh successful runs used the same 500 ms action interval and low-effort Luna Fast subscription route. Jev movement was the fastest tested agent architecture:

| Game / mode | Actions | Screenshots sent to Luna | Total model-call time | Native outcome |
| --- | ---: | ---: | ---: | --- |
| OvO / visual Luna Fast | 15 | 15 | 101.60 s | Level 9 → 10 |
| OvO / Jev phase routing | 15 | 2 | 6.51 s | Level 9 → 10 |
| OvO / Jev movement | 15 | 1 | **5.08 s** | Level 9 → 10 |
| Football / visual Luna Fast | 24 | 24 | 86.79 s | Human scored |
| Football / Jev phase routing | 44 | 5 | 20.48 s | Human scored |
| Football / Jev movement | 29 | 1 | **11.65 s** | Human scored |

Direct Jev movement had median call latency **107 ms on OvO** and **120 ms on Football**. Its one visual escalation in each run preserved the confidence threshold: uncertain crossing in OvO and uncertain super-shot selection in Football. The unpaced benchmark took **7.58 s** and **13.86 s** elapsed respectively, including startup and capture overhead. The visible demo defaults to at most two updates per real second for readability; raise that control for fastest playback. These are small observed runs, not a controlled population benchmark: Football's ball trajectories and action counts differed, and service latency varies. Local scripted rehearsal avoids all inference but is not an agent decision benchmark.

Separate real Chrome UI runs also completed: OvO in **9.60 s elapsed** at the default display setting (15 Jev calls, 1 visual review); Football scored **1–0 in 20.46 s elapsed** at the fastest display setting (81 Jev calls, 2 visual reviews). The longer Football trajectory confirms that its first-goal timing varies with the native bot and ball, while routine decisions remain fast.

The model receives a screenshot and compact instrumented state; validated JSON selects keys, a frame count and a reason. **Guided exploration** is visible in the UI: these are supplied hypotheses, not independent discoveries. Both routes can be changed with `FOOTBALL_MODEL` and `OVO_MODEL` (process environment overrides `.env` model settings), including `gpt-6-luna-fast` to use the OpenAI API key instead of the subscription. `OPENAI_MODEL` remains a fallback for the football route.

**Two decisions per simulated second** is the default: every decision advances exactly 500 ms (20 native Football frames or 30 OvO frames). Visual models use low thinking effort to reduce latency. A key can be tapped for fewer frames using `holdFrames`; inputs are released for the remainder of that interval. Native physics still runs every frame. Inference time does not advance game time. Four observations per game second, **Inspect every physics frame**, and adaptive batches remain optional in visual mode. The display defaults to at most two updates per real second and accounts for inference time instead of adding an extra delay after each call. **Stop** cancels inference and releases input.

OvO also offers **Run guided rehearsal**, a deterministic reproduction of the verified route with ordinary keys and no model calls. At the default 500 ms cadence it completes in 15 batches / 7.5 seconds of controlled play; the labelled rehearsal uses the same observation interval as the live agent. Its evidence report explicitly labels it scripted. Each run reports native outcomes, game time, model wait, action history and the supplied hypothesis. When a completed OvO route crosses above the left wall and stays in the left part of the level, the report identifies the reproduced shortcut from that trajectory. **Export run JSON** saves an inspectable record locally.

The **goal-camping finding** continues until the agent scores **four goals during the run and leads by at least two**. It waits through celebrations and kickoff countdowns, returns to the raised goal, and repeats the strategy. Progress is visible beside the game. The default Football budget is 480 decisions; a native match ending or a budget limit stops the run without claiming that the target was reached. The same target applies to the visual agent and both Jev modes. `npm run verify:goal-camping` checks the stop conditions, kickoff recovery and partial-evidence reporting with controller fixtures; these fixtures are not native match-win evidence.

Credentials stay on the local server. Game screenshots, game observations and recent action history go to the configured OpenAI API or ChatGPT subscription endpoint. Hybrid mode additionally sends the compact plan and categorical game features to OpenRouter's Jev endpoint; it sends Jev no images or raw coordinates. The ChatGPT route uses `store:false`; the library’s OpenAI API route uses the API’s default response-storage setting. Browser assets load locally; model requests are deliberate server-side external connections. Decisions and usage are saved locally under `private/runs/`. Subscription cost fields are API-equivalent estimates, not billed subscription charges.

[GPT-6 Luna documentation](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [image inputs](https://developers.openai.com/api/docs/guides/images-vision), and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## What has actually been demonstrated

| Investigation | Observed result |
| --- | --- |
| Football: camp in the raised left net, wait for natural charge, fire across the field | The verified **Luna Fast subscription run scored 1–0 after 24 decisions** at 2 Hz (12 s of game time, 86.79 s inference). A prior 4 Hz Luna run scored after 67 decisions. These are first-goal outcomes, not completed matches; some earlier attempts failed. |
| OvO credits logo unlock | A live **Luna Fast** screenshot decision located the logo at normalized **(0.50, 0.31)**. Its ordinary double-click plus one native frame changed unlocked levels from **1 to 52**, with **2.439 s** model latency. A separate single-click control left the count at 1. The game explicitly implements this hidden unlock. |
| OvO level 9 left-wall shortcut | A real **GPT-6.1 Sol subscription run** advanced **Level 9 → Level 10 in 19 decisions**: 4.75 s of controlled play, 96.87 s of model inference, 101.97 s elapsed. The ordinary-input, source-guided rehearsal also succeeded in six fresh 4 Hz runs at 18–19 observations / 4.50–4.75 s, and six fresh 2 Hz runs at 15 observations / 7.5 s. Face right at the left wall, release horizontal keys, pulse Up, cross left above the wall, then dive. Earlier Luna and Sol attempts without this precise hint failed. |

Football's prompt includes the net position and an earlier successful strategy. Quick-match AI difficulty is the game's default; this does not establish effectiveness against every bot difficulty or prove a measured fun/balance problem. The finding demonstration now stops at its four-goal/two-goal-lead target or native match end; the historical Football runs above stopped after their first goal. OvO stops at native level completion. Partial runs do not claim the target was reached; the report separates evidence from the proposed balance or route issue.

For the credits demonstration, open `/ovo/findings/credits-unlock` and choose **Run Luna demonstration**. Setup opens the native credits screen; Luna receives its screenshot and the supplied hypothesis, then chooses normalized double-click coordinates without being given the logo's native geometry. The executor sends ordinary mouse events at those exact coordinates and advances one native frame. A miss can trigger up to two further visual decisions; it never substitutes a scripted target or marks an unchanged count successful. Jev is omitted because this short visual targeting task does not need a telemetry routing stage. This is a guided reproduction, not an independent discovery.

Each credits run uses a fresh temporary save: an in-memory adapter for the game's existing storage calls lets native startup create its normal default progress and native events change it. It neither resets the browser's saved game nor edits the level count. The log shows latency and opens the exact application prompt, structured response, and submitted screenshot. Those details are cleared on rerun or leaving, including back/forward caching, and excluded from server run files and JSON exports. **Stop** aborts an in-flight call. `npm run verify:credits` checks real native mouse input with explicit model fixtures, save isolation, miss reporting, cancellation, resizing, and cleanup. The separate live Luna result above is recorded in ignored `evidence/credits-agent/live-luna.json`.

An older firsthand [OvO player guide](https://www.speedrun.com/ovo/guides/kd9vr) describes tapping both directions beside a wall as an infinite-wall-jump technique. That candidate did not reproduce directly. Inspection of the native wall-jump events revealed the facing-dependent input sequence used in the labelled rehearsal. No character, collision, score, charge or completion parameters are edited.

## Agent API

The parent page exposes `window.gameAgent`; `window.football` and `window.ovo` are aliases on their respective pages.

```js
const state = await page.evaluate(() => gameAgent.observe());
const image = await page.evaluate(() => gameAgent.capture());
const action = await yourModel(state, image); // game time does not pass here
const next = await page.evaluate(action => gameAgent.act(action), {
  frames: 20,      // Football: 500 ms; use 30 for OvO
  holdFrames: 3,   // tap for three frames, then release
  keys: ['ArrowRight'],
});
```

`act()` applies keys for `holdFrames`, then releases them for the remaining frames. `step()` accepts 1–400 frames, stops automatic preview, advances the native game clock and returns the observation. Keys remain held until replaced; `keys: []` releases them. `capture()` returns a PNG data URL without advancing time. `releaseKeys()` releases input without stepping. `stop()` stops the optional preview. `startQuickMatch({fireball:true})`, `startLevel(9)` and `openCredits()` use native game setup/navigation functions and explicitly advance their transitions; they do not change physics, charge or score.

`pointer({type:'double_click',x:0.5,y:0.31}, {signal})` sends ordinary canvas mouse events at normalized coordinates and advances one native frame. It also accepts `type:'click'` for a single-click control. An optional `viewport:{width,height}` rejects a stale target if the canvas was resized after capture. The native game performs the hit testing and progression change.

Supported keys include the arrows, WASD, Z/X, Space, R, P, Enter and Escape. The model is restricted to the arrows, Z/X, Space and R. Football's actual kick controls are X (normal), Z (super), Up (jump). OvO uses Up (jump) and Down (slide/smash).

| Game | Native physics | Default observation interval |
| --- | --- | --- |
| Football Legends | 25 ms / 40 Hz | 20 native frames / 500 ms |
| OvO | 16.667 ms / 60 Hz | 30 native frames / 500 ms |

The parent page uses real time; only the game iframe uses synthetic time. `web/clock.js` intercepts Date, performance time, timers and animation callbacks before either runtime loads. After loading, it arms a barrier, with no elapsed-time catch-up between actions. OvO's decorative CSS layout transitions are omitted while preserving their native completion triggers. Numbered gameplay layouts use Construct's native bounded camera so the wider viewport shows the level rather than the black outside-world border; the camera correction changes no physical state. Resizing a frozen viewport redraws without taking a simulation tick. Level 10 also frames the playable side of its entrance wall and floor before rendering: the native player-follow camera otherwise fills a wide viewport with those thick solids. The correction reads the original solid bounds and retains a small visible edge; geometry, collision, zoom, HUD and the camera tracking target are preserved. It is reapplied after native camera updates and viewport resizing. Audio is disabled/muted. Resource loading runs normally before the barrier; this is an integration for these inspected games, not general browser virtualization.

## Reproduce the checks

With the server running:

```sh
npm run verify
npm run agent:football       # real API calls; up to 120 decisions, fixed 500 ms
npm run agent:ovo
npm run benchmark:hybrid:football # real Jev + ChatGPT calls
npm run benchmark:hybrid:ovo
AGENT_STRATEGY=tactical npm run benchmark:hybrid:ovo
AGENT_STRATEGY=tactical npm run benchmark:hybrid:football
npm run verify:hybrid            # offline routing and mocked UI checks
AGENT_DECISIONS=3 AGENT_CADENCE=native npm run agent:football
```

Browser verification checks unchanged native state **and identical pixels** across a four-second real wait, exactly one native update per step, movement and jump inputs, synthetic timers, 4 fps preview, agent takeover, local asset loading, and zero external browser requests/errors. Football retains the bundled Nape 0.9 physics scale: its 25 ms match step advances physics by 22.5 ms. The checks reject blank/transparent production captures, verify capture does not advance time, and check a short key hold inside both 500 ms and 250 ms intervals. The model runner also asserts that observations and pixels remain identical throughout every actual inference call. The rehearsal check exercises the actual UI controller and JSON export, verifies native Level 9 → 10 with zero model calls, rejects false success on menu exits, and checks desktop/mobile viewport resizing without a simulation tick.

Hybrid checks cover actual movement choices, confidence and problem escalation, initial seed-plan preservation, no-image routine requests, local input constraints, cancellation, and truthful reports. Mocked provider replies exercise the real browser controller without paid model calls; the separate benchmark executes the live providers and records call latency, image counts, cost, and native outcomes.

Clock reports, action ledgers and screenshots go to ignored `evidence/`. Preview screenshots go to `private/previews/`. Neither secrets nor game files belong in a Git commit.

Inspected builds: Football Legends **1.1.0p**, Phaser **2.6.4**, Nape and DragonBones **5.6.0**, acquired from [Poki](https://poki.com/en/g/football-legends); OvO **1.4.4**, Construct 2, acquired from [OvO Classic](https://ovo-classic.github.io/play.html). SHA-256 provenance manifests and untouched originals are retained in `private/`. Extraction scripts fail on unexpected patch markers so changed upstream builds require inspection.
