import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHybridDecider, MIN_ROUTING_CONFIDENCE, VISUAL_CHECKPOINT_EVERY, routingProgress} from '../hybrid.mjs';
import {summarizeBaseline, summarizeRequests} from './benchmark-hybrid.mjs';

// Mock providers exercise routing boundaries without network calls or credentials.
// Native controller behavior and timings are verified separately in the browser.
const game = 'football-legends';
const image = 'data:image/png;base64,dGVzdA==';
const state = {state: 'gameplay', match: {score1: 0}, players: []};
const plan = {id: 'test-plan', phase: 'Approach net', goal: 'Test the net strategy.', notes: ''};
const current = {keys: ['ArrowLeft'], frames: 20, holdFrames: 3, phase: 'Approach net', reason: 'Approach.'};
const proposed = {keys: [], frames: 20, holdFrames: 20, phase: 'Adjust camp', reason: 'Settle.'};
const basePolicy = {
  currentPhase: 'Approach net', suggestedPhase: 'Adjust camp', phaseReady: true,
  features: {insideNet: false, superReady: false, progressStalled: false},
  continuationAction: current, proposedAction: proposed, requiresVisualReason: null, completed: false,
};
const tacticalCandidates = {
  move_left: {id: 'move_left', action: current, description: 'Move left.', criteria: 'The target is left.'},
  wait: {id: 'wait', action: {keys: [], frames: 20, holdFrames: 20, phase: 'Wait for charge', reason: 'Wait for charge.'}, description: 'Wait.', criteria: 'The player is settled and charging.'},
};
const routing = (choice = 'continue', confidence = .98) => ({choice, confidence, model: 'test-jev', probabilities: {[choice]: confidence}, latencyMs: 12, usage: {inputTokens: 10, outputTokens: 1}, costUsd: 0});
function fixture({policy = {}, route, review, chooseAction, candidates = tacticalCandidates} = {}) {
  const calls = {route: [], review: [], chooseAction: []};
  const decide = createHybridDecider({
    evaluate: input => ({...basePolicy, ...policy, currentPhase: input.plan.phase || basePolicy.currentPhase}),
    evaluateTactical: input => ({...basePolicy, ...policy, currentPhase: input.plan.phase || basePolicy.currentPhase, candidates, strategyHints: ['Use the supplied strategy.']}),
    route: async (input, signal) => {calls.route.push(input); return route ? route(input, signal) : routing();},
    chooseAction: async (input, signal) => {calls.chooseAction.push(input); return chooseAction ? chooseAction(input, signal) : routing('move_left');},
    review: async (input, signal) => {calls.review.push(input); return review ? review(input, signal) : {plan, model: 'test-chatgpt-fast', transport: 'ChatGPT subscription', latencyMs: 30};},
  });
  return {calls, decide};
}
const request = extra => ({game, state, plan, stepsSinceVisual: 0, ...extra});

test('initial plan requires a screenshot and never silently substitutes a local action', async () => {
  const {decide, calls} = fixture();
  const pending = await decide(request({plan: undefined}));
  assert.equal(pending.needsVisual, true);
  assert.equal(pending.action, undefined);
  assert.equal(calls.route.length, 0);
  assert.equal(calls.review.length, 0);
  const result = await decide(request({plan: undefined, image}));
  assert.equal(result.visualReview, true);
  assert.equal(result.stepsSinceVisual, 0);
  assert.deepEqual(result.action, current);
  assert.equal(calls.review[0].image, image);
  assert.equal(calls.route.length, 0);
});

test('routine Jev requests contain categorical features and progress, without pixels or raw telemetry', async () => {
  const {decide, calls} = fixture();
  const history = [{action: {phase: 'Approach net', reason: 'Move left.'}, before: {ball: {x: 999}}, after: {ball: {x: 500}}, image}];
  const result = await decide(request({stepsSinceVisual: 3, history}));
  assert.deepEqual(result.action, current);
  assert.equal(result.visualReview, false);
  assert.equal(result.stepsSinceVisual, 4);
  assert.equal(calls.review.length, 0);
  assert.deepEqual(Object.keys(calls.route[0]).sort(), ['currentPhase', 'features', 'game', 'phaseReady', 'plan', 'progress', 'suggestedPhase']);
  assert.equal(JSON.stringify(calls.route[0]).includes(image), false);
  assert.equal(JSON.stringify(calls.route[0]).includes('999'), false);
  assert.deepEqual(Object.keys(calls.route[0].progress).sort(), ['expectedMotion', 'latestEvent', 'recentPhases', 'trend']);
  assert.equal(calls.route[0].progress.trend, 'phase_condition_reached');
  assert.deepEqual(calls.route[0].progress.recentPhases, ['Approach net']);
  assert.equal(calls.route[0].progress.latestEvent, null);
  assert.match(calls.route[0].progress.expectedMotion, /raised goal step/);
});

test('OvO progress uses net height gained even when the current jump is falling', () => {
  const player = (y, dy = 0) => ({x: 176, y, behaviors: [{enabled: true, dy, ignoreInput: 1}]});
  const policy = {currentPhase: 'Climb wall', phaseReady: false, features: {falling: true, inputLocked: true}};
  const history = [{action: {phase: 'Climb wall'}, before: {players: [player(1000)]}, after: {players: [player(880)]}}];
  const advancing = routingProgress('ovo', {players: [player(850, 100)]}, history, policy);
  assert.equal(advancing.trend, 'advancing_toward_phase_goal');
  assert.match(advancing.expectedMotion, /Falling briefly.*normal/);
  const receding = routingProgress('ovo', {players: [player(1080, 100)]}, history, policy);
  assert.equal(receding.trend, 'moving_away_from_phase_goal');
});

test('a visual escalation preserves its reason and normalized plan for the follow-up', async () => {
  const {decide, calls} = fixture({route: () => routing('continue', .2)});
  const pending = await decide(request());
  assert.equal(pending.needsVisual, true);
  const reviewed = await decide(request({plan: pending.plan, stepsSinceVisual: pending.stepsSinceVisual, image, reviewReason: pending.reason}));
  assert.equal(calls.review[0].reason, pending.reason);
  assert.equal(calls.review[0].plan.id, pending.plan.id);
  assert.equal(reviewed.routing.reason, pending.reason);
});

test('Jev can authorize only a locally validated next phase', async () => {
  const {decide} = fixture({route: () => routing('change_phase')});
  const result = await decide(request());
  assert.deepEqual(result.action, proposed);
  assert.equal(result.plan.phase, 'Adjust camp');
  const blocked = fixture({policy: {phaseReady: false}, route: () => routing('change_phase')});
  const denied = await blocked.decide(request());
  assert.equal(denied.needsVisual, true);
  assert.equal(denied.action, undefined);
});

test('periodic checkpoint and stalled movement request review before calling Jev', async () => {
  const periodic = fixture();
  const checkpoint = await periodic.decide(request({stepsSinceVisual: VISUAL_CHECKPOINT_EVERY}));
  assert.equal(checkpoint.needsVisual, true);
  assert.match(checkpoint.reason, /Periodic/);
  assert.equal(periodic.calls.route.length, 0);
  const stalled = fixture({policy: {requiresVisualReason: 'Movement stalled.'}});
  const result = await stalled.decide(request());
  assert.equal(result.needsVisual, true);
  assert.equal(result.reason, 'Movement stalled.');
  assert.equal(stalled.calls.route.length, 0);
});

test('low confidence, explicit review, and malformed routing all fail closed', async () => {
  for (const decision of [routing('continue', MIN_ROUTING_CONFIDENCE - .001), routing('request_visual_review'), routing('invent_keys'), routing('continue', Number.NaN), routing('continue', 1.1)]) {
    const {decide} = fixture({route: () => decision});
    const result = await decide(request());
    assert.equal(result.needsVisual, true);
    assert.equal(result.action, undefined);
  }
  const boundary = fixture({route: () => routing('continue', MIN_ROUTING_CONFIDENCE)});
  assert.deepEqual((await boundary.decide(request())).action, current);
});

test('a failed Jev request escalates without substituting inputs or exposing provider details', async () => {
  const {decide} = fixture({route: () => {throw Error('upstream confidential details');}});
  const result = await decide(request());
  assert.equal(result.needsVisual, true);
  assert.equal(result.action, undefined);
  assert.equal(result.reason, 'Jev decision failed.');
});

test('visual review cannot jump to a phase that local state has not authorized', async () => {
  const {decide} = fixture({review: () => ({plan: {...plan, phase: 'Fire super'}})});
  await assert.rejects(decide(request({image})), /valid local transition/);
});

test('invalid local key timings and keys are rejected before they reach the browser', async () => {
  for (const action of [{...current, frames: 1}, {...current, holdFrames: 21}, {...current, holdFrames: 0}, {...current, keys: ['Delete']}]) {
    const {decide} = fixture({policy: {continuationAction: action}});
    await assert.rejects(decide(request()), /invalid action/);
  }
});

test('completed native state returns no action or model request', async () => {
  const {decide, calls} = fixture({policy: {completed: true}});
  const result = await decide(request());
  assert.equal(result.completed, true);
  assert.equal(result.action, null);
  assert.equal(calls.route.length + calls.review.length, 0);
});

test('abort prevents a late model result from becoming an action', async () => {
  const pre = new AbortController(); pre.abort(Error('Stopped before request.'));
  const before = fixture();
  await assert.rejects(before.decide(request(), pre.signal), /Stopped before/);
  assert.equal(before.calls.route.length, 0);
  for (const visual of [false, true]) {
    const controller = new AbortController();
    const stop = async (_, signal) => {
      assert.equal(signal, controller.signal);
      controller.abort(Error('Stopped during request.'));
      return visual ? {plan} : routing();
    };
    const {decide} = fixture(visual ? {review: stop} : {route: stop});
    await assert.rejects(decide(request(visual ? {image} : {}), controller.signal), /Stopped during/);
  }
});

test('bad observations are rejected before either provider is contacted', async () => {
  for (const invalid of [{game: 'unknown'}, {state: null}, {history: {}}, {stepsSinceVisual: -1}, {image: 'https://elsewhere/image.png'}, {plan: []}]) {
    const {decide, calls} = fixture();
    await assert.rejects(decide(request(invalid)));
    assert.equal(calls.route.length + calls.review.length, 0);
  }
});

test('tactical strategy starts with Jev movement and a seeded plan, without an initial screenshot', async () => {
  const {decide, calls} = fixture({chooseAction: () => routing('wait')});
  const result = await decide(request({strategy: 'tactical', plan: undefined}));
  assert.deepEqual(result.action, tacticalCandidates.wait.action);
  assert.notDeepEqual(result.action, basePolicy.continuationAction);
  assert.equal(result.strategy, 'tactical');
  assert.equal(result.plan.source, 'seed');
  assert.equal(result.plan.phase, 'Wait for charge');
  assert.equal(result.visualReview, false);
  assert.equal(result.routing.choice, 'wait');
  assert.equal(calls.chooseAction.length, 1);
  assert.equal(calls.route.length + calls.review.length, 0);
  assert.deepEqual(Object.keys(calls.chooseAction[0]).sort(), ['candidates', 'currentPhase', 'features', 'game', 'plan', 'progress', 'strategyHints']);
});

test('tactical strategy has no scheduled screenshots but retains explicit problem escalation', async () => {
  const normal = fixture();
  const result = await normal.decide(request({strategy: 'tactical', stepsSinceVisual: 100}));
  assert.deepEqual(result.action, current);
  assert.equal(result.stepsSinceVisual, 101);
  assert.equal(normal.calls.review.length, 0);
  const stalled = fixture({policy: {requiresVisualReason: 'Movement stalled.'}});
  const pending = await stalled.decide(request({strategy: 'tactical', stepsSinceVisual: 100}));
  assert.equal(pending.needsVisual, true);
  assert.equal(pending.action, undefined);
  assert.equal(stalled.calls.chooseAction.length, 0);
});

test('tactical uncertainty and unavailable movements request review without executing substitutes', async () => {
  for (const choice of [routing('wait', .2), routing('request_visual_review'), routing('invent_movement'), routing('__proto__')]) {
    const {decide} = fixture({chooseAction: () => choice});
    const result = await decide(request({strategy: 'tactical'}));
    assert.equal(result.needsVisual, true);
    assert.equal(result.action, undefined);
  }
  const invalidTiming = fixture({candidates: {move_left: {...tacticalCandidates.move_left, action: {...current, frames: 1}}}});
  await assert.rejects(invalidTiming.decide(request({strategy: 'tactical'})), /invalid action/);
});

test('tactical visual review selects an available movement and keeps the escalation reason', async () => {
  const {decide, calls} = fixture({
    chooseAction: () => routing('wait', .2),
    review: () => ({plan: {...plan, phase: 'Wait for charge'}, movement: 'wait', latencyMs: 17}),
  });
  const pending = await decide(request({strategy: 'tactical', plan: undefined}));
  const reviewed = await decide(request({strategy: 'tactical', image, plan: pending.plan, reviewReason: pending.reason}));
  assert.deepEqual(reviewed.action, tacticalCandidates.wait.action);
  assert.equal(reviewed.plan.source, 'visual');
  assert.equal(reviewed.plan.id, pending.plan.id);
  assert.equal(reviewed.visualLatencyMs, 17);
  assert.equal(calls.review[0].reason, pending.reason);
  for (const bad of [
    {movement: 'invent_movement', plan},
    {movement: 'wait', plan},
  ]) {
    const invalid = fixture({review: () => bad});
    await assert.rejects(invalid.decide(request({strategy: 'tactical', image})), /unavailable movement/);
  }
});

test('tactical model failure and cancellation leave the next native action unset', async () => {
  const failed = fixture({chooseAction: () => {throw Error('provider internal detail');}});
  const result = await failed.decide(request({strategy: 'tactical'}));
  assert.equal(result.needsVisual, true);
  assert.equal(result.action, undefined);
  const controller = new AbortController();
  const aborted = fixture({chooseAction: (_, signal) => {
    assert.equal(signal, controller.signal);
    controller.abort(Error('Stopped tactical request.'));
    return routing('move_left');
  }});
  await assert.rejects(aborted.decide(request({strategy: 'tactical'}), controller.signal), /Stopped tactical/);
});

test('benchmark summaries preserve cadence and distinguish visual reviews from Jev decisions', () => {
  const baseline = summarizeBaseline({game, scored: true, decisions: [
    {model: 'chatgpt-gpt-6-luna-fast', latencyMs: 100, action: {frames: 20}, before: {clock: {performanceMs: 1000}}, after: {clock: {performanceMs: 1500}}},
    {model: 'chatgpt-gpt-6-luna-fast', latencyMs: 300, action: {frames: 20}, before: {clock: {performanceMs: 1500}}, after: {clock: {performanceMs: 2000}}},
  ]}, 'fixture.json');
  assert.equal(baseline.simulatedSeconds, 1);
  assert.deepEqual(baseline.observationIntervalsMs, [500]);
  assert.equal(baseline.medianDecisionMs, 200);
  assert.equal(baseline.outcome, 'native-success');
  const summary = summarizeRequests([
    {sentImage: true, roundTripMs: 2000, result: {visualReview: true, visualLatencyMs: 1800, latencyMs: 1900, apiEquivalentCostUsd: .01, routing: {choice: 'visual_review'}}},
    {sentImage: false, roundTripMs: 200, result: {action: current, apiEquivalentCostUsd: .001, routing: {choice: 'continue', latencyMs: 100}}},
    {sentImage: false, roundTripMs: 400, result: {needsVisual: true, reason: 'Low confidence.', jev: {choice: 'continue', latencyMs: 300, costUsd: .003}}},
    {sentImage: false, roundTripMs: 5, result: {needsVisual: true, reason: 'Periodic visual checkpoint', latencyMs: 1}},
    {sentImage: false, roundTripMs: 3, result: {completed: true, action: null}},
  ]);
  assert.equal(summary.screenshotInputs, 1);
  assert.equal(summary.visualReviews, 1);
  assert.equal(summary.jevCalls, 2);
  assert.equal(summary.jevCallsLeadingToAction, 1);
  assert.equal(summary.jevCallsLeadingToVisualReview, 1);
  assert.equal(summary.medianJevRoundTripMs, 300);
  assert.equal(summary.medianJevLatencyMs, 200);
  assert.equal(summary.p90JevLatencyMs, 280);
  assert.equal(summary.jevLatencyMs, 400);
  assert.equal(summary.jevCostUsd, .004);
  assert.equal(summary.jevCostSamples, 2);
  assert.equal(summary.medianVisualLatencyMs, 1800);
  assert.equal(summary.visualApiEquivalentCostUsd, .01);
  assert.equal(summary.noModelNeedsVisualHandshakes, 1);
  assert.equal(summary.medianNoModelHandshakeRoundTripMs, 5);
  assert.equal(summary.noModelCompletionResponses, 1);
  assert.equal(summary.requestsWithUncertainProviderAccounting, 0);
  assert.equal(summary.escalations.length, 2);
  assert.deepEqual(summary.escalations.map(item => item.modelCalled), ['jev', 'none']);
});

test('missing provider latency and cost never become zero-valued benchmark samples', () => {
  const summary = summarizeRequests([
    {sentImage: false, roundTripMs: 30, result: {routing: {choice: 'continue'}}},
    {sentImage: false, roundTripMs: 1000, result: {needsVisual: true, reason: 'Jev decision failed.'}},
    {sentImage: true, roundTripMs: 500, result: {visualReview: true, latencyMs: 480}},
  ]);
  assert.equal(summary.jevCalls, 1);
  assert.equal(summary.jevLatencySamples, 0);
  assert.equal(summary.medianJevLatencyMs, null);
  assert.equal(summary.jevCostUsd, null);
  assert.equal(summary.visualApiEquivalentCostUsd, null);
  assert.equal(summary.medianVisualLatencyMs, 480);
  assert.match(summary.accountingNotes.visualLatency, /1 saved reviews/);
  assert.equal(summary.noModelNeedsVisualHandshakes, 0);
  assert.equal(summary.failedRoutingRequestsWithoutResponse, 1);
  assert.equal(summary.requestsWithUncertainProviderAccounting, 1);
  assert.equal(summary.escalations[0].modelCalled, 'unknown');
});
