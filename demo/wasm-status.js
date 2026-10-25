'use strict';
// Visible development evidence only; no internal state is added to match data.
(() => {
  const target=document.getElementById('tracker-engine');
  const render=()=>{
    const status=globalThis.MSADeckTrackerCore.engineStatus();
    target.textContent='合成預覽牌組引擎：'+status.engine+' / '+status.state;
    target.dataset.state=status.state;
  };
  render();globalThis.MSADeckTrackerCore.subscribe(render);
})();
