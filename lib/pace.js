// Ritmo de consumo. Funciona no Node (testes) e no navegador (painel), por isso o invólucro no final.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pace = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const MIN_ELAPSED_MS = 10 * 60e3; // antes disso o ritmo ainda é ruído
  const MIN_FRAC = 0.05;

  // w: { percent, resetsAt (ms), windowMs }
  // frac = quanto da janela já passou; expected = onde você "deveria" estar; projected = uso previsto no reset
  function pace(w, now = Date.now()) {
    if (!w || !w.resetsAt || !w.windowMs) return null;
    const frac = Math.min(1, Math.max(0, 1 - (w.resetsAt - now) / w.windowMs));
    return { frac, expected: frac * 100, projected: frac > 0.03 ? Math.min(999, w.percent / frac) : null };
  }

  // Quando o limite acaba, se continuar neste ritmo e isso acontecer antes do reset.
  //   null                       -> sem risco (ou sem dados suficientes)
  //   { reached: true,  at }     -> já bateu 100%; "at" é quando volta (o reset)
  //   { reached: false, at }     -> vai bater 100% em "at", antes do reset
  function exhaustion(w, now = Date.now()) {
    const p = pace(w, now);
    if (!p || !(w.percent > 0)) return null;
    if (w.percent >= 100) return { reached: true, at: w.resetsAt };
    const elapsed = p.frac * w.windowMs;
    if (p.frac < MIN_FRAC || elapsed < MIN_ELAPSED_MS) return null;
    const at = now + (100 - w.percent) / (w.percent / elapsed);
    return at < w.resetsAt ? { reached: false, at } : null;
  }

  return { pace, exhaustion };
}));
