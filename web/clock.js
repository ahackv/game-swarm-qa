/* Synthetic time applies only to the game iframe. The controller uses real time. */
(() => {
  const NativeDate = Date;
  const native = {
    now: NativeDate.now.bind(NativeDate), perf: performance.now.bind(performance),
    timeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    raf: window.requestAnimationFrame.bind(window), cancelRaf: window.cancelAnimationFrame.bind(window)
  };
  let frozen = false, epoch = 0, perf = 0, frames = 0, serial = 0;
  const timers = new Map(), rafs = new Map();
  const now = () => frozen ? epoch : native.now();
  const invoke = (callback, args) => typeof callback === 'function' ? callback(...args) : window.eval(String(callback));
  window.Date = new Proxy(NativeDate, {
    get: (target, key) => key === 'now' ? now : Reflect.get(target, key),
    apply: () => new NativeDate(now()).toString(),
    construct: (target, args) => Reflect.construct(target, args.length ? args : [now()])
  });
  Object.defineProperty(performance, 'now', { configurable:true, value: () => frozen ? perf : native.perf() });

  function schedule(timer) {
    timer.nativeId = native.timeout(() => {
      if (!timers.has(timer.id) || frozen) return;
      if (timer.repeat) { timer.due = now() + timer.delay; schedule(timer); }
      else timers.delete(timer.id);
      invoke(timer.callback, timer.args);
    }, Math.max(0, timer.due - now()));
  }
  function addTimer(callback, delay, args, repeat) {
    delay = Math.max(repeat ? 1 : 0, Number(delay) || 0);
    const timer = { id:++serial, callback, args, delay, repeat, due:now()+delay, nativeId:null };
    timers.set(timer.id, timer);
    if (!frozen) schedule(timer);
    return timer.id;
  }
  window.setTimeout = (callback, delay, ...args) => addTimer(callback, delay, args, false);
  window.setInterval = (callback, delay, ...args) => addTimer(callback, delay, args, true);
  window.clearTimeout = window.clearInterval = id => {
    const timer = timers.get(id);
    if (timer) { native.clearTimeout(timer.nativeId); timers.delete(id); }
  };
  window.requestAnimationFrame = callback => {
    const id = ++serial, item = { callback, nativeId:null };
    rafs.set(id, item);
    if (!frozen) item.nativeId = native.raf(timestamp => {
      if (frozen || !rafs.has(id)) return;
      rafs.delete(id); callback(timestamp);
    });
    return id;
  };
  window.cancelAnimationFrame = id => {
    const item = rafs.get(id);
    if (item) { native.cancelRaf(item.nativeId); rafs.delete(id); }
  };

  function pause({performanceMs} = {}) {
    if (frozen) return;
    epoch = native.now(); perf = native.perf();
    // Align with a variable-delta engine's last rendered frame when requested.
    if(Number.isFinite(performanceMs)) {epoch-=perf-performanceMs;perf=performanceMs;}
    frozen = true;
    for (const timer of timers.values()) native.clearTimeout(timer.nativeId);
    for (const item of rafs.values()) native.cancelRaf(item.nativeId);
    const game = window.Phaser?.GAMES[0];
    if (game) { game.stage.disableVisibilityChange = true; game.sound.mute = true; }
  }
  function tick(ms = 25) {
    if (!frozen) throw Error('Clock must be paused before stepping.');
    epoch += ms; perf += ms; frames++;
    // Drain timers due in this interval; repeated timers advance from their due time.
    let drained = 0;
    while (true) {
      const due = [...timers.values()].filter(t => t.due <= epoch).sort((a,b) => a.due-b.due || a.id-b.id)[0];
      if (!due) break;
      if (++drained > 10000) throw Error('Timer loop exceeded the per-frame limit.');
      if (due.repeat) due.due += due.delay; else timers.delete(due.id);
      invoke(due.callback, due.args);
    }
    const batch = [...rafs.entries()];
    for (const [id, item] of batch) if (rafs.delete(id)) item.callback(perf);
  }
  window.__gameClock = { pause, tick, get status() { return { frozen, frames, epochMs:now(), performanceMs:performance.now(), timers:timers.size, rafs:rafs.size }; } };
})();
