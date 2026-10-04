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
