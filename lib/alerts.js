// Decide quais notificações disparar a cada leitura. Não depende do Electron, então é testável.
//
// cfg: { enabled, levels: [80, 95], onReset, services: { claude: true, codex: true } }
//
// - Níveis: avisa uma vez ao cruzar cada nível; o aviso volta a valer quando o uso cai (reset).
// - Reset: avisa quando uma janela em que você tinha usado bastante volta a zero.
// - A primeira leitura de cada janela só "aprende" o estado, para não avisar a cada abertura do app.
const RESET_MIN_PERCENT = 50; // só avisa o reset de quem tinha usado pelo menos isso
const RESET_JUMP_MS = 30 * 60e3;

const DEFAULTS = { enabled: true, levels: [80, 95], onReset: true, services: { claude: true, codex: true } };

// Aceita qualquer coisa vinda do arquivo de configurações ou da interface e devolve uma configuração válida.
function normalizeConfig(a) {
  a = a && typeof a === 'object' ? a : {};
  const levels = Array.isArray(a.levels)
    ? [...new Set(a.levels.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 100))].sort((x, y) => x - y).slice(0, 6)
    : [...DEFAULTS.levels];
  const s = a.services && typeof a.services === 'object' ? a.services : {};
  return { enabled: a.enabled !== false, levels, onReset: a.onReset !== false, services: { claude: s.claude !== false, codex: s.codex !== false } };
}

function create() {
  const level = {};   // "serviço/janela" -> maior nível já avisado
  const prev = {};    // "serviço/janela" -> última leitura
  const seeded = new Set();

  function evaluate(svc, name, p, cfg, now = Date.now()) {
    const out = [];
    if (!p || !p.ok) return out;
    const active = cfg.enabled !== false && !(cfg.services && cfg.services[svc] === false);
    const levels = [...(cfg.levels || [])].sort((a, b) => a - b);

    for (const w of p.windows) {
      const key = `${svc}/${w.label}`;
      const reached = levels.filter((l) => w.percent >= l).pop() || 0;
      const before = prev[key];

      if (active && cfg.onReset !== false && before && before.percent >= RESET_MIN_PERCENT) {
        const advanced = w.resetsAt && before.resetsAt && w.resetsAt - before.resetsAt > RESET_JUMP_MS;
        const freed = !w.resetsAt && before.resetsAt && now >= before.resetsAt - 60e3;
        if (advanced || freed) {
          out.push({ kind: 'reset', key, title: `${name} — ${w.label}`, body: `O limite resetou. Você está em ${Math.round(w.percent)}%.` });
        }
      }

      if (!seeded.has(key)) {
        seeded.add(key);
        level[key] = reached;
      } else {
        if (active && reached > (level[key] || 0)) {
          out.push({ kind: 'level', key, level: reached, title: `${name} — ${w.label}`, body: `Você usou ${Math.round(w.percent)}% do limite.` });
        }
        level[key] = reached; // cai a 0 no reset, então o aviso vale de novo
      }
      prev[key] = { percent: w.percent, resetsAt: w.resetsAt };
    }
    return out;
  }

  // chamar quando os níveis mudam, para não avisar na hora de algo que já estava acima
  return { evaluate, reseed() { seeded.clear(); } };
}

module.exports = { create, normalizeConfig, DEFAULTS, RESET_MIN_PERCENT };
