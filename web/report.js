// Reports describe this run's native observations, not an independently
// discovered exploit or a measurement of player enjoyment.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' ? value : '';
const unique = values => [...new Set(values.filter(Boolean))];
const seconds = value => finite(value) ? value.toFixed(2) + ' s' : '—';
const player = (game, state) => state?.players?.find(p => game === 'ovo' ? p.behaviors?.some(b => b.enabled) : p.human);

function scalars(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    !/secret|password|authorization|api.?key|access.?token|refresh.?token|image|screenshot/i.test(key) &&
    (item === null || typeof item === 'boolean' || typeof item === 'string' || finite(item))));
}

// Export known native state fields only. Never copy the request object, image,
// server configuration, or arbitrary model metadata into a downloadable file.
function snapshot(game, state) {
  if (!state) return null;
  const common = {
    clock: scalars(state.clock),
    state: text(state.state),
    players: (state.players || []).map(p => ({...scalars(p), ...(p.behaviors ? {behaviors: p.behaviors.map(scalars)} : {})})),
  };
  if (game === 'football-legends') return {...common, match: scalars(state.match), core: scalars(state.core), ball: state.ball ? scalars(state.ball) : null};
  return {
    ...common, completed: state.completed === true,
    ...(finite(state.unlockedLevels) ? {unlockedLevels: state.unlockedLevels} : {}),
    layout: scalars(state.layout),
    objects: (state.objects || []).filter(o => ['t44', 't45', 't49', 't51', 't67'].includes(o.type)).map(scalars),
  };
}

function numericUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (finite(item)) return [[key, item]];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const children = numericUsage(item);
      if (Object.keys(children).length) return [[key, children]];
    }
    return [];
  }));
}

function decisionRecord(game, entry, index) {
  const a = entry.action || {};
  return {
    decision: index + 1,
    action: {
      keys: Array.isArray(a.keys) ? a.keys.filter(key => typeof key === 'string') : [],
      frames: finite(a.frames) ? a.frames : null,
      holdFrames: finite(a.holdFrames) ? a.holdFrames : finite(a.frames) ? a.frames : null,
      phase: text(a.phase), reason: text(a.reason), hypothesis: text(a.hypothesis),
    },
    before: snapshot(game, entry.before), after: snapshot(game, entry.after),
    event: text(entry.event) || null,
    model: text(entry.model), modelVersion: text(entry.modelVersion), transport: text(entry.transport), thinkingLevel: text(entry.thinkingLevel),
    latencyMs: finite(entry.latencyMs) ? entry.latencyMs : null,
    usage: numericUsage(entry.usage),
    apiEquivalentCostUsd: finite(entry.apiEquivalentCostUsd) ? entry.apiEquivalentCostUsd : null,
    guided: true,
  };
}

/** Build a portable, image-free record. This is also usable without a DOM. */
export function buildReport({game, history = [], baseline, final, status = '', startedAt, finishedAt, mode = 'live'} = {}) {
  if (!['football-legends', 'ovo'].includes(game)) throw Error('Unknown report game.');
  if (!['live', 'scripted'].includes(mode)) throw Error('Unknown report mode.');
  const decisions = history.map((entry, index) => decisionRecord(game, entry, index));
  const initial = snapshot(game, baseline || history[0]?.before);
  const last = snapshot(game, final || history.at(-1)?.after || baseline);
  const states = [initial, ...decisions.map(entry => entry.after), last].filter(Boolean);
  const pairs = decisions.map(entry => [entry.before, entry.after]);
  if (initial && last) pairs.push([initial, last]);
  const sampledPlayers = states.map(state => player(game, state)).filter(Boolean);
  const totalInferenceMs = decisions.reduce((sum, entry) => sum + (entry.latencyMs || 0), 0);
  const models = unique(decisions.map(entry => entry.model));
  const transports = unique(decisions.map(entry => entry.transport));
  const nativeElapsed = last?.clock?.simulationSeconds - initial?.clock?.simulationSeconds;
  const simulationSeconds = finite(nativeElapsed) && nativeElapsed >= 0 ? nativeElapsed : null;
  const startedMs = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  const finishedMs = typeof finishedAt === 'number' ? finishedAt : Date.parse(finishedAt);
  const elapsedMs = finishedMs - startedMs;
  const wallSeconds = finite(elapsedMs) && elapsedMs >= 0 ? elapsedMs / 1000 : null;
  const facts = [];
  let outcome = 'unconfirmed', title = 'Hypothesis unconfirmed';
  let hypothesis, interpretation, nextStep;

  if (game === 'football-legends') {
    const goal = pairs.some(([before, after]) => finite(before?.match?.score1) && after?.match?.score1 > before.match.score1);
    if (goal) { outcome = 'goal-observed'; title = 'Goal observed'; }
    const score = state => finite(state?.match?.score1) && finite(state?.match?.score2) ? state.match.score1 + '–' + state.match.score2 : null;
    if (score(initial) && score(last)) facts.push('Native scoreboard: ' + score(initial) + ' → ' + score(last) + '.');
    if (goal) facts.push('The native human score increased during the recorded run.');
    if (sampledPlayers.some(p => finite(p.x) && p.x <= 105)) facts.push('A recorded observation placed the human player beside or inside its left goal (x ≤ 105).');
    if (decisions.some(entry => {
      const before = player(game, entry.before), after = player(game, entry.after);
      return entry.action.keys.includes('KeyZ') && before?.superReady && finite(after?.superCharge) && after.superCharge < before.superCharge;
    })) facts.push('Super charge decreased after a Z input while the ability had been ready.');
    hypothesis = 'Camp inside the raised goal, let the fireball charge naturally, then shoot across the pitch.';
    interpretation = goal ? 'The run produced a goal. Repeated comparisons are needed to assess the seeded strategy’s advantage and its effect on play.' : 'This run has not established the proposed advantage from goal camping and the charged shot.';
    nextStep = goal ? 'Repeat from fresh matches and compare goals, concessions, and time spent waiting against an active-play baseline.' : 'Repeat the guided route, inspect the charge and ball timing, and record a native score increase before treating the hypothesis as supported.';
  } else {
    const completionCard = states.some(state => state.completed === true);
    const advanced = initial?.state === 'Level 9' && states.some(state => Number(/^Level (\d+)$/.exec(state.state)?.[1]) > 9);
    const completed = completionCard || advanced;
    if (completed) { outcome = 'level-completed'; title = 'Level completion observed'; }
    if (initial?.state && last?.state) facts.push('Native layout: ' + initial.state + (initial.state === last.state ? '.' : ' → ' + last.state + '.'));
    if (completionCard) facts.push('The native level-completion card was visible in a recorded observation.');
    else if (advanced) facts.push('The game advanced from level 9 to a later native level; completion is inferred from this progression because the transient completion card was not captured.');
    else if (last) facts.push('The final recorded state has no visible native level-completion card.');
    const firstPlayer = player(game, initial);
    const routePlayers = states.filter(state => state.state === 'Level 9').map(state => player(game, state)).filter(Boolean);
    const ys = routePlayers.map(p => p.y).filter(finite);
    if (finite(firstPlayer?.y) && ys.length) facts.push('Highest sampled position was ' + Math.max(0, firstPlayer.y - Math.min(...ys)).toFixed(0) + ' px above the starting position.');
    if (routePlayers.some(p => finite(p.x) && p.x <= 177)) facts.push('The player reached the left wall area in a recorded observation (x ≤ 177).');
    const aboveWall = routePlayers.findIndex(p => finite(p.x) && finite(p.y) && p.x <= 180 && p.y <= 552);
    const crossed = aboveWall >= 0 && routePlayers.slice(aboveWall).some(p => finite(p.x) && p.x <= 145);
    const stayedLeft = routePlayers.length > 0 && routePlayers.every(p => finite(p.x) && p.x <= 340);
    const shortcut = completed && crossed && stayedLeft;
    if(shortcut) {title='Left-wall shortcut reproduced';facts.push('Successive observations placed the player above the left wall (y ≤ 552), then to its left (x ≤ 145), before native completion. The recorded route stayed on the left side of level 9.');}
    if (finite(initial?.unlockedLevels) && finite(last?.unlockedLevels) && last.unlockedLevels > initial.unlockedLevels) facts.push('Native progression increased from ' + initial.unlockedLevels + ' to ' + last.unlockedLevels + ' unlocked levels.');
    hypothesis = 'On level 9, lower the left gate and climb the wall to bypass the normal route.';
    interpretation = shortcut ? 'Facing away from the wall and pulsing jump bypassed the normal route. This creates a candidate progression issue: the obstacle sequence can be skipped.' : completed ? 'The native outcome supports reviewing this route. Use the recorded trajectory to confirm the left-wall bypass and compare its time with the intended route.' : 'The proposed level-9 shortcut remains unconfirmed. The recorded movement has not yet established a successful bypass.';
    nextStep = completed ? 'Review the recorded route, reproduce it from a fresh level, and compare completion time with the intended route.' : 'Inspect the wall-jump input sequence and the full wall height, then reproduce a route that reaches the native completion card.';
  }
  if (!decisions.length && !initial) {
    title = 'Awaiting a recorded run';
    facts.push('Run the agent to collect native game observations and an action record.');
  }
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), game, mode, guided: true,
    provenance: mode === 'scripted' ? 'This run replayed a scripted input sequence for the displayed seed hypothesis. No model inference or independent discovery is claimed.' : 'The agent received the displayed seed hypothesis. This is guided exploration, not a claim of independent discovery.',
    status: text(status), outcome, title, hypothesis, facts, interpretation, nextStep,
    metrics: {decisions: decisions.length, simulationSeconds, wallSeconds, totalInferenceMs, averageInferenceMs: decisions.length ? totalInferenceMs / decisions.length : null, models, transports},
    baseline: initial, final: last, decisions,
  };
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

/** Render into #finding-report, or a caller-supplied root. Returns the record. */
export function renderReport(options, root = document.querySelector('#finding-report')) {
  const report = buildReport(options);
  if (!root) return report;
  root.classList.add('finding-report');
  root.dataset.outcome = report.outcome;
  root.setAttribute('aria-label', 'Recorded QA finding');
  const header = element('div', 'report-header');
  const heading = element('div');
  heading.append(element('div', 'eyebrow', 'Run evidence / ' + (report.mode === 'scripted' ? 'Scripted rehearsal' : 'Guided exploration')), element('h2', 'report-title', report.title));
  const download = element('button', 'report-download', 'Export run JSON ↓');
  download.type = 'button';
  download.disabled = !report.decisions.length;
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], {type: 'application/json'}));
    const link = element('a');
    link.href = url;
    link.download = 'swarm-qa-' + report.game + '-' + report.createdAt.replace(/[:.]/g, '-') + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  header.append(heading, download);
  const metrics = element('dl', 'report-metrics');
  for (const [label, value] of [
    [report.mode === 'scripted' ? 'Input batches' : 'Decisions', String(report.metrics.decisions)],
    ['Game time', seconds(report.metrics.simulationSeconds)],
    [report.mode === 'scripted' ? 'Control' : 'Model wait', report.mode === 'scripted' ? 'Scripted' : seconds(report.metrics.totalInferenceMs / 1000)],
    ...(report.metrics.wallSeconds === null ? [] : [['Elapsed', seconds(report.metrics.wallSeconds)]]),
  ]) {
    const item = element('div'); item.append(element('dt', '', label), element('dd', '', value)); metrics.append(item);
  }
  const facts = element('ul', 'report-facts');
  for (const fact of report.facts) facts.append(element('li', '', fact));
  const evidence = element('div', 'report-evidence');
  evidence.append(element('h3', '', 'Observed facts'), facts);
  const hypothesis = element('div', 'report-hypothesis');
  hypothesis.append(element('h3', '', 'Seed hypothesis'), element('p', '', report.hypothesis), element('p', 'report-interpretation', report.interpretation));
  const body = element('div', 'report-body'); body.append(evidence, hypothesis);
  const next = element('p', 'report-next'); next.append(element('strong', '', 'Next QA step. '), document.createTextNode(report.nextStep));
  const route = report.mode === 'scripted' ? 'Scripted input sequence' : report.metrics.models.length ? report.metrics.models.join(', ') + ' · ' + report.metrics.transports.join(', ') : 'No model decisions recorded';
  const metadata = element('p', 'report-metadata', route + (report.mode === 'scripted' ? ' · Native state + inputs · Scripted rehearsal' : ' · Screenshot + instrumented state · Guided prompt'));
  root.replaceChildren(header, metrics, body, next, metadata);
  return report;
}
