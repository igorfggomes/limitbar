// Tema do painel: "system" segue o Windows; "light" e "dark" forçam. Aceita qualquer coisa vinda do arquivo de
// configurações ou da interface e devolve um valor válido.
const THEMES = ['system', 'light', 'dark'];
const normalize = (v) => (THEMES.includes(v) ? v : 'system');

module.exports = { THEMES, normalize };
