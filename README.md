# Swarm QA

**Swarm QA doesn’t just find bugs. It finds where the game isn’t fun.**

This local hackathon prototype runs the **original Football Legends and OvO games** on an agent-controlled clock. A game stays frozen while an agent examines a screenshot and decides what to press. The agent then advances an explicit number of native frames. The home page opens each game at a separate URL, without the surrounding game portal, ads or analytics.

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

In another terminal, run `npm run verify` to check both games and generate their home-page preview images. If Chrome is unavailable, run `npx playwright install chromium`. `BROWSER_EXECUTABLE` can select another Chromium binary; `PORT` defaults to 4173. Browser scripts currently target port 4173.

Acquisition downloads the inspected public builds into **ignored `private/` storage**. The repository contains our harness, extraction patches and verification code; it does not distribute game bundles, game art, screenshots or recordings. The MIT license covers the original harness code. Original game ownership and attribution remain with MADPUFFERS and DEDRA GAMES.

## Watch the agents

Set these values in the ignored `.env`, then restart the server:

```dotenv
OPENAI_API_KEY=your-key-here
FOOTBALL_MODEL=chatgpt-gpt-6-luna-fast
OVO_MODEL=chatgpt-gpt-6-luna-fast
```

The demo uses [`@ljoukov/llm` 9.0.0](https://www.npmjs.com/package/@ljoukov/llm/v/9.0.0). **Run Luna Fast agent** starts Football's native 1v1 quick match using a fireball character against the built-in bot. OvO also defaults to Luna Fast, using the verified wall-jump hint. Both games use your existing local Codex/ChatGPT login and the library’s `-fast` priority route. Set either model to `chatgpt-gpt-6.1-sol-fast` for the stronger fallback. Subscription tokens remain on the server; no cloud keys are needed for this local flow. An existing token provider or Codex proxy can also be configured using the library's documented environment variables. The UI displays the active credential route.

A subsequent Luna subscription run also completed OvO in 18 decisions at 2 Hz (9 s game time, 71.47 s total inference), confirming that Sol is not required for the guided route.

The model receives a screenshot and compact instrumented state; validated JSON selects keys, a frame count and a reason. **Guided exploration** is visible in the UI: these are supplied hypotheses, not independent discoveries. Both routes can be changed with `FOOTBALL_MODEL` and `OVO_MODEL` (process environment overrides `.env` model settings), including `gpt-6-luna-fast` to use the OpenAI API key instead of the subscription. `OPENAI_MODEL` remains a fallback for the football route.

**Two screenshots per simulated second** is the default: every decision advances exactly 500 ms (20 native Football frames or 30 OvO frames). Both models use low thinking effort to reduce latency. The model can tap a key for fewer frames using `holdFrames`; inputs are released for the remainder of that interval. Native physics still runs every frame. Inference may take several real seconds, during which game time and pixels stay frozen. Four observations per game second, **Inspect every physics frame**, and adaptive batches remain optional. The display defaults to at most two updates per real second. **Stop** cancels inference, releases input and leaves the game frozen.

OvO also offers **Run guided rehearsal**, a deterministic reproduction of the verified route with ordinary keys and no model calls. At the default 500 ms cadence it completes in 15 batches / 7.5 seconds of controlled play; the labelled rehearsal uses the same observation interval as the live agent. Its evidence report explicitly labels it scripted. Each run reports native outcomes, game time, model wait, action history and the supplied hypothesis. When a completed OvO route crosses above the left wall and stays in the left part of the level, the report identifies the reproduced shortcut from that trajectory. **Export run JSON** saves an inspectable record locally.

Credentials stay on the local server. Only game screenshots, game observations and recent action history are sent to the configured OpenAI API or ChatGPT subscription endpoint. The ChatGPT route uses `store:false`; the library’s OpenAI API route uses the API’s default response-storage setting. Browser assets load locally; model requests are deliberate server-side external connections. Decisions and usage are saved locally under `private/runs/`. Subscription cost fields are API-equivalent estimates, not billed subscription charges.

[GPT-6 Luna documentation](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [image inputs](https://developers.openai.com/api/docs/guides/images-vision), and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## What has actually been demonstrated

| Investigation | Observed result |
| --- | --- |
| Football: camp in the raised left net, wait for natural charge, fire across the field | The verified 4 Hz live Luna run scored **1–0 after 67 decisions** (16.75 s of controlled play). Earlier guided runs also scored at 20 and 35 decisions with adaptive batches. These are first-goal outcomes, not completed matches; some earlier attempts failed. |
| OvO credits logo unlock | A normal desktop **double click** on the central **DEDRA logo** changed native unlocked levels from 1 to **52**. A single click left it at 1. The game explicitly implements this hidden unlock. |
| OvO level 9 left-wall shortcut | A real **GPT-6.1 Sol subscription run** advanced **Level 9 → Level 10 in 19 decisions**: 4.75 s of controlled play, 96.87 s of model inference, 101.97 s elapsed. The ordinary-input, source-guided rehearsal also succeeded in six fresh 4 Hz runs at 18–19 observations / 4.50–4.75 s, and six fresh 2 Hz runs at 15 observations / 7.5 s. Face right at the left wall, release horizontal keys, pulse Up, cross left above the wall, then dive. Earlier Luna and Sol attempts without this precise hint failed. |

Football's prompt includes the net position and an earlier successful strategy. Quick-match AI difficulty is the game's default; this does not establish effectiveness against every bot difficulty or prove a measured fun/balance problem. The agent stops at a native goal or level completion. Unsuccessful experiments remain unconfirmed; the report separates evidence from the proposed balance or route issue.

For the reliable credits demonstration, open OvO, click **Open credits**, double-click the central logo, then **Step 1 physics frame**. The page displays the game's own unlocked-level count. This action is a scripted/manual reproduction, not an LLM discovery.

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

Supported keys include the arrows, WASD, Z/X, Space, R, P, Enter and Escape. The model is restricted to the arrows, Z/X, Space and R. Football's actual kick controls are X (normal), Z (super), Up (jump). OvO uses Up (jump) and Down (slide/smash).

| Game | Native physics | Default observation interval |
| --- | --- | --- |
| Football Legends | 25 ms / 40 Hz | 20 native frames / 500 ms |
| OvO | 16.667 ms / 60 Hz | 30 native frames / 500 ms |

The parent page uses real time; only the game iframe uses synthetic time. `web/clock.js` intercepts Date, performance time, timers and animation callbacks before either runtime loads. After loading, it arms a barrier, with no elapsed-time catch-up between actions. OvO's decorative CSS layout transitions are omitted while preserving their native completion triggers. Numbered gameplay layouts use Construct's native bounded camera so the wider viewport shows the level rather than the black outside-world border; the camera correction changes no physical state. Resizing a frozen viewport redraws without taking a simulation tick. Actual black level geometry, such as Level 10’s interior walls, is preserved. Audio is disabled/muted. Resource loading runs normally before the barrier; this is an integration for these inspected games, not general browser virtualization.

## Reproduce the checks

With the server running:

```sh
npm run verify
npm run agent:football       # real API calls; up to 120 decisions, fixed 500 ms
npm run agent:ovo
AGENT_DECISIONS=3 AGENT_CADENCE=native npm run agent:football
```

Browser verification checks unchanged native state **and identical pixels** across a four-second real wait, exactly one native update per step, movement and jump inputs, synthetic timers, 4 fps preview, agent takeover, local asset loading, and zero external browser requests/errors. Football retains the bundled Nape 0.9 physics scale: its 25 ms match step advances physics by 22.5 ms. The checks reject blank/transparent production captures, verify capture does not advance time, and check a short key hold inside both 500 ms and 250 ms intervals. The model runner also asserts that observations and pixels remain identical throughout every actual inference call. The rehearsal check exercises the actual UI controller and JSON export, verifies native Level 9 → 10 with zero model calls, rejects false success on menu exits, and checks desktop/mobile viewport resizing without a simulation tick.

Clock reports, action ledgers and screenshots go to ignored `evidence/`. Preview screenshots go to `private/previews/`. Neither secrets nor game files belong in a Git commit.

Inspected builds: Football Legends **1.1.0p**, Phaser **2.6.4**, Nape and DragonBones **5.6.0**, acquired from [Poki](https://poki.com/en/g/football-legends); OvO **1.4.4**, Construct 2, acquired from [OvO Classic](https://ovo-classic.github.io/play.html). SHA-256 provenance manifests and untouched originals are retained in `private/`. Extraction scripts fail on unexpected patch markers so changed upstream builds require inspection.
