# Troca de conta Claude (pessoal / corporativa)

**Data:** 2026-11-01
**Status:** aprovado para planejamento

## Problema

O LimitBar lê o uso do Claude a partir de `~/.claude/.credentials.json` — o mesmo arquivo que a CLI usa para autenticar. Quem tem mais de uma conta Claude (ex. pessoal e corporativa) hoje precisa rodar `claude` no terminal e logar manualmente toda vez que quiser trocar, porque cada login sobrescreve o arquivo anterior. O usuário quer trocar de conta pelo LimitBar e, a partir daí, qualquer comando no terminal já consumir o limite da conta selecionada — sem logout/login manual.

## Escopo

- Vale só para **Claude** (Codex não tem esse conceito de arquivo único de login trocável da mesma forma; fora de escopo).
- Guardar múltiplos **perfis de conta** (snapshots do `.credentials.json`) com apelido escolhido pelo usuário.
- Trocar a conta ativa = regravar `.credentials.json` com o snapshot escolhido. Não existem duas sessões simultâneas: a CLI sempre vê a conta que estiver selecionada no LimitBar.
- Detectar automaticamente quando um login novo (ainda não salvo como perfil) aparece no arquivo, e perguntar se quer salvá-lo.
- Fora de escopo: mostrar uso de contas inativas; sincronizar contas entre máquinas; suportar múltiplas sessões de terminal simultâneas com contas diferentes.

## Mecanismo

### 1. Armazenamento dos perfis

Novo módulo `lib/accounts.js` (sem dependência do Electron, mesmo padrão de `providers.js`/`alerts.js`, testável isoladamente).

Pasta de perfis: `path.join(app.getPath('userData'), 'claude-accounts')` (mesma pasta onde o LimitBar já guarda `window.json`, via `writeJson`/`readJson` existentes em `main.js`). Cada perfil é um arquivo `<id>.json`:

```js
// <id>.json
{
  "id": "a1b2c3",              // gerado uma vez (ex. hash curto do accessToken no momento do save), nunca muda
  "label": "Pessoal",          // apelido editável
  "savedAt": 1730000000000,
  "credentials": { /* conteúdo integral de .credentials.json naquele momento */ }
}
```

Um arquivo `active.json` separado guarda `{ "id": "a1b2c3" }` — qual perfil é considerado "ativo" (o último selecionado pelo LimitBar). Serve para desenhar o apelido certo na faixa mesmo antes de qualquer leitura nova de uso.

### 2. Detecção de login novo

`providers.js` já lê `.credentials.json` periodicamente (`readCreds`). Em `accounts.js`, expor:

```js
accounts.identify(credentialsJson) // -> { id, known: boolean }
```

`id` é derivado de forma estável do `refreshToken` atual (ex. hash SHA-256 curto) — não do `accessToken`, que muda a cada renovação. A cada leitura de credenciais no loop existente de `providers.js`, o processo principal compara o `id` atual com a lista de perfis salvos:

- **Id já conhecido** e diferente do `active.json` atual → atualiza `active.json` silenciosamente (o usuário trocou de conta rodando `claude` direto no terminal, fora do LimitBar; o LimitBar só acompanha).
- **Id desconhecido** → dispara notificação do Windows "Login novo detectado — salvar como conta?" com ação que abre o painel de configurações, seção Claude, com um campo de apelido pré-focado e os dados do snapshot prontos para salvar. Se o usuário ignorar a notificação, ela não repete para o mesmo `id` nessa sessão do app (evita spam a cada poll), mas o snapshot não é salvo até confirmação.

### 3. Troca de conta

IPC novo, mesmo padrão de `settings:*` existente em `main.js`:

- `accounts:list` → `sendSettings` passa a incluir `accounts: { list: [{id, label, active}], ... }`.
- `accounts:switch` (`id`) → `accounts.switchTo(id)`:
  1. Bloqueia se `providers.js` estiver com uma renovação de token em andamento para a conta ativa (checar a flag `refreshing` já existente — expor um getter em `providers.js`).
  2. Lê o snapshot do perfil, grava em `.credentials.json` com `writeAtomic` (já existe em `providers.js`; promover para util compartilhado ou reexportar).
  3. Atualiza `active.json`.
  4. Invalida `claudeCache` em `providers.js` (expor `providers.invalidateCache()`) e força uma nova consulta de uso, para a faixa não mostrar o percentual da conta anterior pelos próximos ~2,5 min.
- `accounts:rename` (`id`, `label`) e `accounts:remove` (`id`) → operações simples no arquivo do perfil (remover o perfil ativo é permitido, só desmarca `active.json`; não mexe no `.credentials.json` em disco).
- `accounts:save-current` (`label`) → usado tanto pelo fluxo manual quanto pela confirmação da notificação de login novo: lê `.credentials.json` atual e grava como novo perfil.

### 4. UI

- **Faixa**: rótulo pequeno com o apelido da conta ativa ao lado das barras do Claude (texto, sem ícone novo). Clique abre um menu simples (reaproveita o padrão de `Menu`/popup já usado no clique direito da faixa) listando os perfis salvos + "Salvar conta atual..." quando o `id` ativo não bate com nenhum perfil.
- **Configurações (⚙ → Claude)**: lista de perfis salvos com botões renomear/remover, abaixo do que já existe para renovação automática de login.
- Se não houver nenhum perfil salvo ainda, a faixa não mostra rótulo nenhum (comportamento idêntico ao atual) — a feature é totalmente opt-in.

## Limitações assumidas

- Não há duas sessões simultâneas: trocar de conta no LimitBar é equivalente a logout/login manual, só automatizado. Um terminal já aberto com uma sessão em andamento continua usando o token que tinha em memória até a próxima chamada que releia o arquivo (comportamento já existente da CLI, não é algo que o LimitBar controla).
- O `id` do perfil depende do `refreshToken` ser estável o bastante entre renovações para reconhecer "é a mesma conta". Na pior hipótese (refresh token mudou de forma inesperada) o LimitBar trata como login novo e oferece salvar de novo — não quebra, só perde a ligação com o apelido antigo.
- Perfis salvos ficam em texto puro no disco local (mesmo nível de proteção que o próprio `.credentials.json` da CLI já tem hoje — não é uma regressão de segurança, mas duplica a superfície: agora há N arquivos com tokens válidos em vez de um).

## Testes

Seguindo o padrão de `tests/providers.*.test.js`:

- `accounts.js`: salvar perfil, `identify()` reconhece perfil salvo vs. desconhecido, `switchTo()` grava o arquivo certo e atualiza `active.json`, renomear, remover (inclusive remover o ativo).
- Integração leve com `providers.js`: `switchTo()` seguido de leitura de uso usa o token do perfil novo (mock do `fetch`), e `claudeCache` foi invalidado.
- Bloqueio de troca durante `refreshing` ativo.
