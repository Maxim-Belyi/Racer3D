export function runCountdown(onComplete) {
  const el = document.querySelector('[data-js-countdown]');
  const steps = ['3', '2', '1', 'GO!'];
  let i = 0;

  el.style.display = 'flex';

  function tick() {
    el.textContent = steps[i];
    el.dataset.step = steps[i] === 'GO!' ? 'go' : 'num';
    el.classList.remove('countdown--pop');
    void el.offsetWidth;
    el.classList.add('countdown--pop');

    i++;
    if (i < steps.length) {
      setTimeout(tick, 850);
    } else {
      setTimeout(() => {
        el.style.display = 'none';
        onComplete();
      }, 600);
    }
  }

  tick();
}
