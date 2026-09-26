// @ts-nocheck
// Migrated source for the built-in video feature; resources are owned by FeatureScope.
export function video(scope, config) {
const window = scope.window; const document = scope.document;
function setupVideoControl(config) {
  if (!config.enabled) {
    return;
  }
  let frame = null;
  function bindNodes() {
    const video = document.querySelector(config.videoSelector);
    const toggle = document.querySelector(config.toggleSelector);
    if (video && config.unmuteOnVideoClick && !video.dataset.nzUnmuteBound) {
      video.dataset.nzUnmuteBound = "1";
      scope.listen(video, "click", () => {
        video.muted = false;
      });
    }
    if (toggle && config.toggleMuteOnControlClick && !toggle.dataset.nzMuteToggleBound) {
      toggle.dataset.nzMuteToggleBound = "1";
      scope.listen(toggle, "click", () => {
        const currentVideo = document.querySelector(config.videoSelector);
        if (!currentVideo) {
          return;
        }
        currentVideo.muted = !currentVideo.muted;
      });
    }
  }
  function scheduleBind() {
    if (frame) {
      return;
    }
    frame = scope.requestAnimationFrame(() => {
      frame = null;
      bindNodes();
    });
  }
  bindNodes();
  const observer = scope.mutationObserver(scheduleBind);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}
setupVideoControl(config);
scope.own(() => document.querySelectorAll('[data-nz-unmute-bound],[data-nz-mute-toggle-bound]').forEach(node => {
  delete node.dataset.nzUnmuteBound;
  delete node.dataset.nzMuteToggleBound;
}));
}
