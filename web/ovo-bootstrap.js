// Loading runs in real time until the parent arms the synthetic game clock.
window.C2_RegisterSW = () => {};
// Audio is disabled for a visual QA demo; no audio fetches or audio clock run.
if (window.Howler) {
  Howler.mute(true);
  if(Howler._codecs) for(const codec of ['m4a','mp4','aac']) Howler._codecs[codec]=false;
}
for(const method of ['play','stop','pause','resume','load','unload','setMuted','setVolume','setLinearVolume']) HowlerAudioPlayer[method]=()=>{};
HowlerAudioPlayer.isPlaying=()=>false;
HowlerAudioPlayer.getVolume=HowlerAudioPlayer.getLinearVolume=()=>0;
// Native CSS transition events follow wall time. Keep the game's transition
// triggers but omit their decorative HTML animation between canvas layouts.
const transition=cr.plugins_.hmmg_layoutTransition_v2.prototype;
transition.acts.prepareTransition=function(){this.runtime.trigger(transition.cnds.isTransitionReady,this);};
transition.acts.startTransition=function(){this.runtime.trigger(transition.cnds.didTransitionStart,this);this.runtime.trigger(transition.cnds.didTransitionFinish,this);};
// The original levels allow their camera to scroll beyond the level rectangle.
// Near the left edge/floor, the wider embedded viewport then mostly shows the
// game's black outside-world border. Use Construct's native camera bounds for
// gameplay layouts so the view stays on the level, without scaling geometry or
// changing collision, movement, timing, or completion rules. Menus keep their
// original camera behavior.
const startLayout = cr.layout.prototype.startRunning;
cr.layout.prototype.startRunning = function (...args) {
  if (/^Level \d+$/.test(this.name)) this.unbounded_scrolling = false;
  return startLayout.apply(this, args);
};
// Level 10 starts beside a thick interior wall and floor. MagiCam centers on
// the player, putting most of a wide viewport inside those black solids even
// though it is within the overall level bounds. Frame the playable side of
// that entrance instead. Read the original solid bounds; keep their geometry,
// the camera's tracking target, game scale and HUD unchanged.
const cameraFrames = new WeakMap();
function frameLevelEntrance(runtime) {
  const layout = runtime.running_layout;
  if (layout?.name !== 'Level 10') return;
  const wall = runtime.getObjectByUID(1067), floor = runtime.getObjectByUID(1069);
  const player = runtime.types_by_index.find(type => type.sid === 980093774729797)
    ?.instances.find(instance => instance.behavior_insts.some(behavior => behavior.enabled));
  if (!wall || !floor || !player) return;
  wall.update_bbox(); floor.update_bbox();
  if (player.x < wall.bbox.right || player.y < wall.bbox.top || player.y > floor.bbox.top) return;
  const scale = player.layer.getScale();
  if (!(scale > 0)) return;
  const halfWidth = runtime.draw_width / scale / 2;
  const halfHeight = runtime.draw_height / scale / 2;
  const margin = 16; // retain a visible strip of the actual wall/floor
  const previous = cameraFrames.get(layout);
  // A resize can redraw without a new MagiCam tick. Reframe from the tracking
  // position, rather than accumulating the preceding viewport's offset.
  const nativeX = previous?.x === layout.scrollX ? previous.nativeX : layout.scrollX;
  const nativeY = previous?.y === layout.scrollY ? previous.nativeY : layout.scrollY;
  layout.scrollX = Math.max(nativeX, wall.bbox.right - margin + halfWidth);
  layout.scrollY = Math.min(nativeY, floor.bbox.top + margin - halfHeight);
  cameraFrames.set(layout, {nativeX,nativeY,x:layout.scrollX,y:layout.scrollY});
}
// MagiCam rewrites scroll coordinates on every tick. Apply framing before
// either renderer, including capture() and redraws following an iframe resize.
for (const method of ['draw', 'drawGL']) {
  const draw = cr.runtime.prototype[method];
  cr.runtime.prototype[method] = function (...args) {
    frameLevelEntrance(this);
    return draw.apply(this, args);
  };
}
// Construct normally resizes and recalculates its render scale inside tick().
// A frozen game must still follow an iframe resize without taking a physics
// step. Reproduce only that viewport calculation, then redraw the same state.
window.addEventListener('resize', () => {
  const runtime = window.cr_getC2Runtime?.();
  if (!window.__gameClock?.status.frozen || !runtime?.running_layout ||
      innerWidth <= 0 || innerHeight <= 0) return;
  runtime.setSize(innerWidth, innerHeight);
  const originalAspect = runtime.original_width / runtime.original_height;
  const aspect = runtime.width / runtime.height;
  const fullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement ||
    document.mozFullScreen || document.webkitIsFullScreen || document.fullScreen ||
    document.msFullscreenElement || runtime.isNodeFullscreen) && !runtime.isCordova;
  const mode = fullscreen && runtime.fullscreen_scaling > 0
    ? runtime.fullscreen_scaling : runtime.fullscreen_mode;
  runtime.aspect_scale = mode >= 2
    ? ((mode !== 2 && aspect > originalAspect) || (mode === 2 && aspect < originalAspect)
      ? runtime.height / runtime.original_height : runtime.width / runtime.original_width)
    : (runtime.isRetina ? runtime.devicePixelRatio : 1);
  runtime.running_layout.boundScrolling();
  if (runtime.glwrap) runtime.drawGL(); else runtime.draw();
});
jQuery(document).ready(() => cr_createRuntime('c2canvas'));
