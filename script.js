// Vanguard Trinity — AI Operational Doctrine
// Subtle pulse animation on metric boxes to simulate live telemetry
(function () {
  function randomInterval(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pulseMetric(box) {
    box.style.transition = 'border-color 0.3s ease, background 0.3s ease';
    box.style.borderColor = '#4a7aaa';
    box.style.background = '#0f1e30';
    setTimeout(function () {
      box.style.borderColor = '';
      box.style.background = '';
    }, 600);
  }

  window.addEventListener('DOMContentLoaded', function () {
    var metrics = document.querySelectorAll('.metric-box');
    if (!metrics.length) return;

    metrics.forEach(function (box) {
      (function tick() {
        var delay = randomInterval(4000, 12000);
        setTimeout(function () {
          pulseMetric(box);
          tick();
        }, delay);
      })();
    });
  });
})();
