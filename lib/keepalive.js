// "Manter a janela de 5h ativa": quando a janela de 5 horas de um serviço está parada, envia uma
// mensagem mínima pela CLI oficial para iniciar a próxima. Tudo aqui é lógica pura (sem Electron e sem
// rede): quem executa o comando e lê o uso de verdade é injetado, então dá para testar.
//
// Por que tantas travas: uma decisão errada aqui gasta limite de verdade, repetidamente.
//   - desligado por padrão; só dispara com a janela comprovadamente inativa;
//   - espera depois de cada tentativa, com espera crescente quando falha;
//   - no máximo 3 tentativas por "janela inativa" e 8 por dia, por serviço;
//   - mede o custo de cada disparo e DESLIGA o serviço se passar do teto.

const LABEL_5H = '5 horas';
const SERVICES = ['claude', 'codex'];
const CEILING_CHOICES = [1, 2, 3, 5];
const DEFAULTS = { enabled: false, services: { claude: true, codex: true }, ceilingPct: 2 };

const STARTUP_GRACE_MS = 60e3;          // logo após abrir o app, as leituras ainda estão assentando
const OK_WAIT_MS = 12 * 60e3;           // depois de um disparo, dá tempo de a leitura mostrar a janela nova
const FAIL_BACKOFF_MS = [10, 20, 40, 60, 120].map((m) => m * 60e3);
const EPISODE_MAX = 3;                  // tentativas por janela inativa
const DAY_MAX = 8;                      // tentativas por dia (uma janela dura 5h: o normal é ~5)
const KEEP_ATTEMPTS = 50;

function normalizeConfig(a) {
  a = a && typeof a === 'object' ? a : {};
  const s = a.services && typeof a.services === 'object' ? a.services : {};
  const ceil = Number(a.ceilingPct);
  return {
    enabled: a.enabled === true, // opt-in: só liga com um "true" explícito
    services: { claude: s.claude !== false, codex: s.codex !== false },
    ceilingPct: CEILING_CHOICES.includes(ceil) ? ceil : DEFAULTS.ceilingPct,
  };
}

// 'active' | 'inactive' | 'unknown'  (na dúvida, "unknown": nunca dispara por palpite)
function fiveHourState(reading, now = Date.now()) {
  if (!reading) return 'unknown';
  if (!reading.ok) return reading.code === 'no-data' ? 'inactive' : 'unknown'; // Codex instalado e nunca usado
  if (reading.stale) return 'unknown'; // valor guardado: não dá para saber
  const w = reading.windows.find((x) => x.label === LABEL_5H);
  if (!w) return 'inactive';
  return w.resetsAt && w.resetsAt > now ? 'active' : 'inactive';
}

const no = (reason) => ({ trigger: false, reason });

function backoffFor(consecutiveFails) {
  return FAIL_BACKOFF_MS[Math.min(Math.max(consecutiveFails, 1), FAIL_BACKOFF_MS.length) - 1];
}

// attempts: histórico de tentativas reais (sem as de teste), em ordem cronológica
function decide({ svc, reading, cfg, attempts = [], episode = 0, now = Date.now(), startedAt = 0, disabled = false }) {
  if (!cfg.enabled || cfg.services[svc] === false) return no('off');
  if (disabled) return no('disabled');
  if (now - startedAt < STARTUP_GRACE_MS) return no('startup');
  const state = fiveHourState(reading, now);
  if (state === 'active') return no('active');
  if (state === 'unknown') return no('unknown');

  const mine = attempts.filter((a) => a.svc === svc && !a.test);
  const last = mine[mine.length - 1];
  if (last) {
    let fails = 0;
    for (let i = mine.length - 1; i >= 0 && !mine[i].ok; i--) fails++;
    if (now - last.at < (last.ok ? OK_WAIT_MS : backoffFor(fails))) return no('wait');
  }
  if (episode >= EPISODE_MAX) return no('gave-up');
  if (mine.filter((a) => now - a.at < 24 * 3600e3).length >= DAY_MAX) return no('daily-cap');
  return { trigger: true };
}

const w5 = (reading) => (reading && reading.ok ? reading.windows.find((x) => x.label === LABEL_5H) : null);

// deps: {
//   runCommand(svc) -> Promise<{ ok, error? }>   executa a mensagem mínima
//   readFresh(svc)  -> Promise<leitura>          lê o uso de novo (sem cache)
//   notify({ title, body }), store: { load() -> { attempts, disabled }, save(state) }, now()
// }
function createKeepAlive({ runCommand, readFresh, notify = () => {}, store, now = Date.now }) {
  const saved = (store && store.load()) || {};
  const state = {
    attempts: Array.isArray(saved.attempts) ? saved.attempts.slice(-KEEP_ATTEMPTS) : [],
    disabled: { claude: null, codex: null, ...(saved.disabled || {}) },
    episode: { claude: 0, codex: 0 },
    gaveUpNotified: { claude: false, codex: false },
    running: false,
  };
  const startedAt = now();
  const persist = () => { if (store) store.save({ attempts: state.attempts.slice(-KEEP_ATTEMPTS), disabled: state.disabled }); };

  async function attempt(svc, before, cfg, { test = false } = {}) {
    state.running = true;
    const t = now();
    const entry = { svc, at: t, ok: false, started: false, cost: null, test, message: '' };
    try {
      const res = await runCommand(svc);
      entry.ok = !!res.ok;
      if (!res.ok) {
        entry.message = res.error || 'falhou';
      } else {
        const after = await readFresh(svc);
        const a = w5(after), b = w5(before);
        entry.started = !!(a && a.resetsAt && a.resetsAt > now());
        const base = b && b.resetsAt && b.resetsAt > t ? b.percent : 0; // janela já em andamento: mede só a diferença
        if (a) entry.cost = Math.max(0, Math.round((a.percent - base) * 10) / 10);
        entry.message = entry.started ? 'janela iniciada' : 'enviado, mas a janela ainda não apareceu na leitura';
      }
    } catch (e) {
      entry.message = e && e.message ? e.message : String(e);
    }
    state.attempts.push(entry);
    if (!test) state.episode[svc] += 1;

    // teto de custo: se um disparo custou mais que o combinado, desliga este serviço (um teste só informa)
    if (!test && entry.cost != null && entry.cost > cfg.ceilingPct) {
      state.disabled[svc] = { at: t, cost: entry.cost, ceiling: cfg.ceilingPct };
      notify({
        title: `Janela automática desligada — ${svc === 'claude' ? 'Claude' : 'Codex'}`,
        body: `Um disparo custou ${entry.cost}%, acima do teto de ${cfg.ceilingPct}%. Ligue de novo nas configurações se quiser.`,
      });
    }
    persist();
    state.running = false;
    return entry;
  }

  // chamado a cada leitura. Não dispara em paralelo: uma tentativa por vez.
  async function tick(readings, cfg) {
    if (state.running) return;
    for (const svc of SERVICES) {
      const reading = readings[svc];
      if (fiveHourState(reading, now()) === 'active') { state.episode[svc] = 0; state.gaveUpNotified[svc] = false; }
      const d = decide({ svc, reading, cfg, attempts: state.attempts, episode: state.episode[svc], now: now(), startedAt, disabled: !!state.disabled[svc] });
      if (d.reason === 'gave-up' && !state.gaveUpNotified[svc]) {
        state.gaveUpNotified[svc] = true;
        notify({
          title: `Não consegui iniciar a janela — ${svc === 'claude' ? 'Claude' : 'Codex'}`,
          body: `Tentei ${EPISODE_MAX} vezes sem sucesso. Veja o motivo em ⚙ → Janela de 5h.`,
        });
      }
      if (d.trigger) await attempt(svc, reading, cfg);
    }
  }

  // "Testar agora": roda uma vez para cada serviço pedido, ignora as travas de repetição e não desliga nada
  async function testNow(svcs, readings, cfg) {
    if (state.running) return [];
    const out = [];
    for (const svc of svcs) out.push(await attempt(svc, readings[svc], cfg, { test: true }));
    return out;
  }

  function clearDisabled(svc) {
    if (state.disabled[svc]) { state.disabled[svc] = null; state.episode[svc] = 0; state.gaveUpNotified[svc] = false; persist(); }
  }

  function status() {
    const last = {};
    for (const svc of SERVICES) {
      const mine = state.attempts.filter((a) => a.svc === svc);
      last[svc] = mine[mine.length - 1] || null;
    }
    return { running: state.running, last, disabled: { ...state.disabled } };
  }

  return { tick, testNow, clearDisabled, status, _state: state };
}

module.exports = {
  createKeepAlive, decide, fiveHourState, normalizeConfig, backoffFor,
  DEFAULTS, SERVICES, CEILING_CHOICES, LABEL_5H, EPISODE_MAX, DAY_MAX, OK_WAIT_MS, STARTUP_GRACE_MS,
};
