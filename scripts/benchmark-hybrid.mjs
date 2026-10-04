import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {browser} from './browser.mjs';
import {captureGame} from './verify-helpers.mjs';
import {describe} from '../web/observations.js';

const median = values => quantile(values, .5);
function quantile(values, proportion) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * proportion;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
}

// Different native outcomes and different trajectories are not paired trials.
// Only claim an observed latency comparison; keep cadence and outcomes beside it.
export function summarizeBaseline(record, path) {
  const decisions = record.decisions || [];
  const times = decisions.map(item => Number(item.latencyMs)).filter(Number.isFinite);
  const initial = record.baseline || decisions[0]?.before;
  const final = record.final || decisions.at(-1)?.after;
  const simulatedMs = initial?.clock && final?.clock
    ? final.clock.performanceMs - initial.clock.performanceMs
    : null;
  const nativeFps = record.game === 'ovo' ? 60 : 40;
  const frames = decisions.map(item => item.action?.frames).filter(Number.isFinite);
  return {
    path, game: record.game, models: [...new Set(decisions.map(item => item.model || record.model).filter(Boolean))],
    decisions: decisions.length, simulatedSeconds: simulatedMs === null ? null : simulatedMs / 1000,
    observationIntervalsMs: [...new Set(frames.map(value => value * 1000 / nativeFps))],
    inferenceMs: times.reduce((sum, value) => sum + value, 0),
    medianDecisionMs: median(times), p90DecisionMs: quantile(times, .9),
    outcome: record.outcome || (record.scored ? 'native-success' : record.interrupted ? 'level-exited' : 'unconfirmed'),
    screenshotInputs: decisions.length,
    screenshotCountBasis: 'One screenshot per decision in the saved visual-agent run.',
  };
}

export function summarizeRequests(requests) {
  const withoutImage = requests.filter(item => !item.sentImage);
  const imageRequests = requests.filter(item => item.sentImage);
  const visual = requests.filter(item => item.result?.visualReview);
  const finite = values => values.filter(value => typeof value === 'number' && Number.isFinite(value));
  const times = items => finite(items.map(item => item.roundTripMs));
  const sum = values => values.reduce((total, value) => total + value, 0);
  // Escalated Jev responses are nested under `jev`, while action-producing
  // responses put the same metadata in `routing` and the response root.
  const jev = requests.flatMap(item => {
    const result = item.result || {};
    if (result.jev) return [{request: item, latencyMs: result.jev.latencyMs, costUsd: result.jev.costUsd ?? result.jev.usage?.cost}];
    if (result.routing && result.routing.choice !== 'visual_review') return [{request: item, latencyMs: result.routing.latencyMs, costUsd: result.apiEquivalentCostUsd ?? result.usage?.cost}];
    return [];
  });
  const jevRequests = new Set(jev.map(item => item.request));
  const failedRouting = withoutImage.filter(item => !jevRequests.has(item) && (item.result?.jevAttempted || item.result?.routeAttempted || /^Jev |^OPENROUTER_API_KEY/.test(item.result?.reason || '')));
  const noModelHandshakes = withoutImage.filter(item => item.result?.needsVisual && !jevRequests.has(item) && !failedRouting.includes(item));
  const noModelCompletion = withoutImage.filter(item => item.result?.completed && !jevRequests.has(item));
  const unclassified = requests.filter(item => !jevRequests.has(item) && !visual.includes(item) && !noModelHandshakes.includes(item) && !noModelCompletion.includes(item));
  const jevLatencies = finite(jev.map(item => item.latencyMs));
  const jevCosts = finite(jev.map(item => item.costUsd));
  const visualLatencies = finite(visual.map(item => item.result.visualLatencyMs ?? item.result.latencyMs));
  const visualCosts = finite(visual.map(item => item.result.apiEquivalentCostUsd));
  const visualOrchestrationFallbacks = visual.filter(item => !Number.isFinite(item.result.visualLatencyMs)).length;
  return {
    requests: requests.length, screenshotInputs: imageRequests.length, routineRequestsWithoutImage: withoutImage.length,
    visualReviews: visual.length, jevCalls: jev.length,
    jevCallsLeadingToAction: jev.filter(item => item.request.result.action).length,
    jevCallsLeadingToVisualReview: jev.filter(item => item.request.result.needsVisual).length,
    noModelNeedsVisualHandshakes: noModelHandshakes.length, noModelCompletionResponses: noModelCompletion.length,
    failedRoutingRequestsWithoutResponse: failedRouting.length, requestsWithUncertainProviderAccounting: unclassified.length,
    remoteWaitMs: sum(times(requests)),
    jevLatencySamples: jevLatencies.length, jevLatencyMs: sum(jevLatencies),
    medianJevLatencyMs: median(jevLatencies), p90JevLatencyMs: quantile(jevLatencies, .9),
    medianJevRoundTripMs: median(times([...jevRequests])), p90JevRoundTripMs: quantile(times([...jevRequests]), .9),
    jevCostSamples: jevCosts.length, jevCostUsd: jevCosts.length ? sum(jevCosts) : null,
    visualLatencySamples: visualLatencies.length, visualLatencyMs: sum(visualLatencies),
    medianVisualLatencyMs: median(visualLatencies), p90VisualLatencyMs: quantile(visualLatencies, .9),
    medianVisualRoundTripMs: median(times(visual)), p90VisualRoundTripMs: quantile(times(visual), .9),
    visualCostSamples: visualCosts.length, visualApiEquivalentCostUsd: visualCosts.length ? sum(visualCosts) : null,
    medianNoModelHandshakeRoundTripMs: median(times(noModelHandshakes)),
    accountingNotes: {
      jevCalls: 'Counts recorded Jev responses, including responses that requested visual escalation. Requests without a provider response are reported separately and may have unknown provider usage.',
      jevLatency: 'Uses Jev call latency from routing.latencyMs or the escalated jev.latencyMs. Excludes no-model handshakes and visual reviews.',
      visualLatency: visualOrchestrationFallbacks ? `${visualOrchestrationFallbacks} saved reviews lack visualLatencyMs and use response latencyMs, which includes local orchestration.` : 'Uses visualLatencyMs for the screenshot planner call.',
      costs: 'Jev cost is the reported OpenRouter cost, including escalations. Visual cost is API-equivalent, not a charge to the ChatGPT subscription. Missing costs remain null.',
    },
    escalations: withoutImage.filter(item => item.result?.needsVisual).map(item => ({reason: item.result.reason, modelCalled: jevRequests.has(item) ? 'jev' : failedRouting.includes(item) ? 'unknown' : 'none', routing: item.result.routing || item.result.jev})),
  };
}

async function readBaselines(game) {
  const paths = game === 'football-legends'
    ? ['evidence/football-luna-fast-2hz-live.json']
    : ['evidence/ovo-luna-fast-2hz-visual/run.json', 'evidence/ovo-luna-2hz-low/run.json', 'evidence/ovo-sol-live-success.json'];
  const records = [];
  for (const path of paths) {
    try {records.push(summarizeBaseline(JSON.parse(await readFile(path, 'utf8')), path));}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return records;
}

export async function benchmarkHybrid({game = 'football-legends', strategy = 'routed', limit = 40, baseUrl = 'http://localhost:4173', directory = `evidence/hybrid-${game === 'ovo' ? 'ovo' : 'football'}${strategy === 'tactical' ? '-tactical' : ''}`} = {}) {
  assert.ok(['football-legends', 'ovo'].includes(game), 'Choose football-legends or ovo.');
  assert.ok(['routed', 'tactical'].includes(strategy), 'AGENT_STRATEGY must be routed or tactical.');
  assert.ok(Number.isInteger(limit) && limit > 0 && limit <= 240, 'Decision limit must be an integer from 1 to 240.');
  await mkdir(directory, {recursive: true});
  const baselines = await readBaselines(game);
  const requests = [], decisions = [];
  const nativeFps = game === 'ovo' ? 60 : 40;
  const startedAt = new Date().toISOString(), started = performance.now();
  let page, initial, final, plan, stepsSinceVisual = 0, outcome = 'unconfirmed', failure = null;
  let captureCalls = 0, artifactCaptureCalls = 0, captureStats = [], localActionMs = 0;
  let unchangedStateChecks = 0, nativeActionChecks = 0;
  const b = await browser();
  const summary = () => ({
    schemaVersion: 1, game, mode: 'hybrid', strategy, guided: true, startedAt,
    cadence: '2hz', nativeFps, outcome, failure, initial: initial && describe(game, initial), final: final && describe(game, final),
    checks: {nativeStateUnchangedDuringRequests: unchangedStateChecks, onlyExplicitNativeFramesAdvanced: nativeActionChecks,
      routineRequestsExcludedImages: requests.filter(item => !item.sentImage).length, nonblankVisualInputsVerified: captureCalls},
    metrics: {...summarizeRequests(requests), localActions: decisions.length, captureCalls: captureCalls + artifactCaptureCalls, observationCaptureCalls: captureCalls, artifactCaptureCalls, captureStats,
      localActionMs, elapsedMs: performance.now() - started,
      simulatedSeconds: initial && final ? (final.clock.performanceMs - initial.clock.performanceMs) / 1000 : 0},
    comparison: {qualification: 'Saved runs used different trajectories, model settings, and sometimes cadence. This is a descriptive latency comparison, not a matched accuracy benchmark.', baselines},
    decisions, requests,
  });
  const persist = () => writeFile(directory + '/run.json', JSON.stringify(summary(), null, 2));
  try {
    page = await b.newPage({viewport: {width: 1280, height: 1040}});
    await page.goto(baseUrl + '/' + game);
    await page.waitForFunction(() => window.gameAgent?.observe().ready, {}, {timeout: 15000});
    if (game === 'football-legends') await page.evaluate(() => gameAgent.startQuickMatch({fireball: true}));
    else await page.evaluate(() => gameAgent.startLevel(9));
    initial = final = await page.evaluate(() => gameAgent.observe());
    for (let index = 0; index < limit; index++) {
      const before = await page.evaluate(() => gameAgent.observe());
      let needsVisual = strategy === 'routed' && !plan, result, reviewReason;
      // At most one escalation followed by one visual review for this action.
      // Errors leave the native game untouched and stop the run.
      for (let attempt = 0; attempt < 2; attempt++) {
        const input = {game, strategy, state: describe(game, before), history: decisions.slice(-8).map(item => ({action: item.action, before: item.before, after: item.after})), plan, stepsSinceVisual, ...(reviewReason ? {reviewReason} : {})};
        if (needsVisual) {
          assert.ok(captureCalls < 20, 'Stop after 20 visual reviews to bound benchmark inference.');
          const captured = await captureGame(page, {path: directory + '/visual-' + String(captureCalls).padStart(3, '0') + '.png'});
          captureCalls++; captureStats.push({...captured.stats, purpose: 'model-observation'}); input.image = captured.dataUrl;
        }
        assert.equal(Object.hasOwn(input, 'image'), needsVisual, 'Routine requests must omit the image field entirely.');
        const requestStart = performance.now();
        const response = await fetch(baseUrl + '/api/hybrid/decision', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input),
          signal: AbortSignal.timeout(65000),
        });
        const body = await response.json();
        const roundTripMs = performance.now() - requestStart;
        assert.deepEqual(await page.evaluate(() => gameAgent.observe()), before, 'Native simulation must not advance during either model request.');
        unchangedStateChecks++;
        requests.push({decision: index + 1, sentImage: needsVisual, stateFrame: before.clock.frames, status: response.status, roundTripMs, result: body});
        if (!response.ok) throw Error(body.error || `Hybrid request failed (${response.status}).`);
        result = body;
        if (!result.needsVisual) break;
        assert.equal(needsVisual, false, 'A visual request must produce an action, completion, or an explicit error.');
        reviewReason = result.reason;
        plan = result.plan || plan;
        stepsSinceVisual = result.stepsSinceVisual ?? stepsSinceVisual;
        needsVisual = true;
      }
      plan = result.plan || plan;
      stepsSinceVisual = result.stepsSinceVisual ?? stepsSinceVisual;
      if (result.completed && !result.action) {
        const nativeSuccess = game === 'football-legends'
          ? before.match.score1 > initial.match.score1
          : before.completed || Number(/^Level (\d+)$/.exec(before.state)?.[1]) > 9;
        assert.ok(nativeSuccess, 'Controller completion must be backed by the native outcome.');
        final = before; outcome = game === 'ovo' ? 'level-completed' : 'goal-observed'; break;
      }
      assert.ok(result.action, 'Every actionable response must include an action.');
      assert.equal(result.action.frames, nativeFps / 2, 'Hybrid actions must use the selected two observations per simulated second.');
      const actionStart = performance.now();
      final = await page.evaluate(action => gameAgent.act(action), result.action);
      const actionDurationMs = performance.now() - actionStart;
      localActionMs += actionDurationMs;
      assert.equal(final.clock.frames - before.clock.frames, result.action.frames, 'Only explicit native frames may advance.');
      assert.ok(Math.abs(final.clock.performanceMs - before.clock.performanceMs - 500) < 1e-6, 'Each native action must advance exactly 500 ms.');
      nativeActionChecks++;
      const entry = {decision: index + 1, ...result, actionDurationMs, before: describe(game, before), after: describe(game, final)};
      decisions.push(entry);
      if (game === 'football-legends' && final.match.score1 > initial.match.score1) outcome = 'goal-observed';
      if (game === 'ovo' && (final.completed || Number(/^Level (\d+)$/.exec(final.state)?.[1]) > 9)) outcome = 'level-completed';
      else if (game === 'ovo' && final.state !== 'Level 9') outcome = 'level-exited';
      await persist();
      const player = final.players.find(item => item.human) || final.players.find(item => item.behaviors?.[0]?.enabled);
      console.log(JSON.stringify({decision: index + 1, visualReview: result.visualReview, model: result.model, routing: result.routing, action: result.action, x: player?.x, y: player?.y, outcome}));
      if (outcome !== 'unconfirmed') break;
    }
    // A final artifact is not a model observation and is separately accounted.
    const captured = await captureGame(page, {path: directory + '/final-game.png'});
    artifactCaptureCalls++;
    captureStats.push({...captured.stats, purpose: 'final-artifact'});
    await page.screenshot({path: directory + '/final.png', fullPage: true});
    await persist();
    console.log(JSON.stringify({finished: true, game, strategy, outcome, metrics: summary().metrics, comparison: summary().comparison}));
    return summary();
  } catch (error) {
    failure = error.message;
    await persist();
    throw error;
  } finally {await b.close();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  benchmarkHybrid({game: process.argv[2] || 'football-legends', strategy: process.env.AGENT_STRATEGY || 'routed', limit: Number(process.env.AGENT_DECISIONS || 40), baseUrl: process.env.SWARM_BASE_URL || 'http://localhost:4173', ...(process.env.AGENT_EVIDENCE_DIR ? {directory: process.env.AGENT_EVIDENCE_DIR} : {})})
    .catch(error => {console.error(error.message); process.exitCode = 1;});
}
