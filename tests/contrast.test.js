const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Lê as cores do próprio CSS do painel e garante o contraste mínimo de leitura (WCAG: 4,5:1 para texto pequeno,
// 3:1 para elementos gráficos como as barras) nos dois temas. Se alguém trocar uma cor por outra fraca, quebra aqui.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const vars = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
const darkBlock = /:root\s*\{([^}]*)\}/.exec(html)[1];
const lightBlock = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(html)[1];
const DARK = vars(darkBlock);
const LIGHT = { ...DARK, ...vars(lightBlock) }; // o tema claro herda o que não redefine

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// fundo aproximado do painel em cada tema (o vidro do Windows muda o tom, mas dentro desta faixa)
const BG = { dark: '#1f2026', light: '#f2f2f3' };
const TEXT = ['fg', 'mut', 'ok', 'warn', 'bad', 'head'];   // viram texto pequeno
const GRAPHIC = ['claude', 'codex', 'ok', 'warn', 'bad'];   // viram barras

for (const [name, tokens] of [['escuro', DARK], ['claro', LIGHT]]) {
  const bg = BG[name === 'escuro' ? 'dark' : 'light'];
  test(`tema ${name}: texto pequeno tem contraste de pelo menos 4,5:1`, () => {
    for (const t of TEXT) {
      assert.ok(tokens[t], `falta a variável --${t}`);
      const c = contrast(tokens[t], bg);
      assert.ok(c >= 4.5, `--${t} (${tokens[t]}) tem só ${c.toFixed(2)}:1 sobre ${bg} no tema ${name}`);
    }
  });
  test(`tema ${name}: as cores das barras têm pelo menos 3:1`, () => {
    for (const t of GRAPHIC) {
      const c = contrast(tokens[t], bg);
      assert.ok(c >= 3, `--${t} (${tokens[t]}) tem só ${c.toFixed(2)}:1 sobre ${bg} no tema ${name}`);
    }
  });
}

test('o tema claro realmente redefine as cores de estado (não herda as do escuro)', () => {
  const light = vars(lightBlock);
  for (const t of ['fg', 'mut', 'ok', 'warn', 'bad', 'head']) assert.ok(light[t], `o tema claro precisa definir --${t}`);
});
