# Alerta sonoro de fim de execução / decisão pendente

**Data:** 2026-10-31
**Status:** aprovado para planejamento

## Problema

O LimitBar hoje só monitora percentual de uso dos limites (Claude/Codex), lido por polling a cada ~2,5 min. Ele não tem nenhuma visão sobre o estado de uma sessão em andamento — se o Claude Code ou o Codex CLI estão processando, terminaram de responder, ou estão parados esperando uma decisão do usuário (ex.: permissão de ferramenta). O usuário quer um alerta sonoro (liga/desliga) para ser avisado desses dois momentos sem precisar ficar olhando o terminal.

## Escopo

- Vale para **Claude Code e Codex** (configurável por serviço, mesmo padrão dos blocos `alerts` e `keepAlive` já existentes).
- Dois eventos disparam o alerta, com o **mesmo som** para ambos:
  - **Terminou de responder** (Claude: hook `Stop`; Codex: `notify` em fim de turno).
  - **Esperando decisão do usuário** (Claude: hook `Notification`, disparado por exemplo quando uma permissão de ferramenta está pendente ou a sessão fica ociosa esperando input).
- Fora de escopo: histórico de eventos, estatísticas, múltiplos sons por tipo de evento, funcionar com o LimitBar fechado.

## Mecanismo

### 1. Configuração (liga/desliga)

Novo bloco de configurações, irmão de `alerts` e `keepAlive`, com o mesmo formato de persistência (`settings.json` do LimitBar) e os mesmos controles de UI (chip por serviço):

```js
// cfg: { enabled: false, services: { claude: true, codex: true } }
```

Desligado por padrão (feature nova, evita escrever nas configs do usuário sem ele pedir).

### 2. Hook/notify nativos das CLIs

Ao **ligar** o alerta para um serviço, o LimitBar escreve nos arquivos de configuração dessa CLI, com merge não-destrutivo (preserva hooks/notify que já existam — mesmo cuidado hoje aplicado ao `.credentials.json` do Claude em `providers.js`):

- **Claude Code** (`~/.claude/settings.json`, respeitando `CLAUDE_CONFIG_DIR`): adiciona um hook em `hooks.Stop` e outro em `hooks.Notification`, cada um chamando:
  ```
  node "<pasta de instalação do LimitBar>/lib/signal-hook.js" claude <stop|notification>
  ```
- **Codex** (`~/.codex/config.toml`, respeitando `CODEX_HOME`): define a chave `notify`:
  ```toml
  notify = ["node", "<pasta>/lib/signal-hook.js", "codex", "turn-complete"]
  ```
  Se `notify` já existir (usuário configurou outra coisa), o LimitBar **não sobrescreve**: avisa na UI que já existe uma configuração de `notify` e não liga o alerta pro Codex até o usuário resolver o conflito manualmente (Codex só aceita um `notify`, diferente dos hooks do Claude que aceitam lista).

Ao **desligar**, o LimitBar remove exatamente a entrada que ele mesmo adicionou (guarda o que escreveu, não um snapshot genérico do arquivo inteiro, para não apagar edições manuais do usuário feitas nesse meio tempo).

### 3. Sinal entre o processo da CLI e o LimitBar

`lib/signal-hook.js` é um script Node standalone (sem dependência do Electron, só `fs`/`path`/`os`, testável como `providers.js`/`alerts.js`). Ele:
1. Recebe `<svc> <kind>` como argumentos (`kind` ∈ `stop`, `notification`, `turn-complete`).
2. Garante que `%LOCALAPPDATA%\LimitBar` existe.
3. Faz **append** de uma linha JSON em `events.log` nessa pasta: `{"svc":"claude","kind":"stop","ts":1730000000000}`.
4. Sai com código 0 sempre (mesmo em erro de escrita) — nunca pode travar ou falhar a CLI que o chamou.

O processo principal do LimitBar observa esse arquivo com `fs.watch` e lê só o trecho novo (por offset guardado em memória, mesmo padrão de leitura incremental de `lastRateLimits` em `providers.js`, adaptado para ler do fim guardado em vez do fim do arquivo). Cada linha nova vira um evento: toca o som (reaproveita `notify()` existente em `main.js`, que usa `Notification` do Electron — no Windows isso já dispara o som padrão do sistema) e mostra o toast:
- "Claude — terminou" / "Claude — esperando sua decisão"
- "Codex — terminou"

O arquivo `events.log` é truncado (ou rotacionado) quando passa de um tamanho pequeno (ex. 64 KB) para não crescer indefinidamente — ele não precisa de histórico, só do que ainda não foi lido.

## Limitações assumidas

- Só funciona com o LimitBar **aberto**. Eventos disparados com o app fechado não tocam som (o `signal-hook.js` ainda grava no arquivo, mas ninguém está observando) nem são "reproduzidos" quando o app abre depois.
- Exige **Node.js no PATH** para o hook rodar — mesma exigência que a função "Janela de 5h automática" já tem.
- O hook `Notification` do Claude Code dispara em mais de uma situação (não só permissão de ferramenta — também idle timeout esperando input); o alerta trata todas elas como "esperando decisão", sem diferenciar.
- O Codex só permite um `notify` por configuração; se o usuário já tiver um customizado, o alerta do Codex fica indisponível até ele resolver isso manualmente.

## Testes

Seguindo o padrão de `tests/alerts.test.js` e `tests/providers.*.test.js`:
- `signal-hook.js`: grava a linha esperada, cria a pasta se não existir, nunca lança/retorna código != 0.
- Leitor de eventos (incremental por offset): lê só linhas novas, ignora linha cortada/incompleta, lida com o arquivo sendo truncado externamente.
- Merge/remoção de hooks no `settings.json` do Claude: preserva hooks existentes de outras ferramentas, idempotente (ligar duas vezes não duplica), remove só a entrada própria ao desligar.
- Escrita/leitura do `notify` no `config.toml` do Codex: detecta `notify` pré-existente e recusa sobrescrever.
