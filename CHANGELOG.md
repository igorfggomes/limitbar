# Changelog

As notas de cada versão aparecem na página de [Releases](https://github.com/igorfggomes/limitbar/releases).
O fluxo de publicação usa a seção da versão deste arquivo como texto da Release.

## 1.3.0 — 2026-10-20

### Novidades
- **Alertas configuráveis**: escolha os níveis de aviso (50, 70, 80, 90, 95%), receba um aviso quando o limite **resetar** e silencie por serviço (Claude ou Codex).
- **Previsão de esgotamento**: quando você está acima do ritmo, a barra mostra "no ritmo atual, o limite acaba às 14:32".
- **Renovação automática do login do Claude**: se o token expirar, o LimitBar renova sozinho, sem precisar abrir o Claude Code. Pode ser desligada nas configurações.
- **Primeiro uso guiado**: boas-vindas na primeira abertura, com a opção de iniciar com o Windows, e mensagens que dizem o que fazer quando o Claude Code ou o Codex não estão instalados ou logados.
- "Iniciar com o Windows" agora também está nas configurações.
- A Release passa a trazer o arquivo `.sha256`, e o atualizador o usa para conferir o download.

### Por trás
- Testes automáticos (`npm test`) e integração contínua no GitHub.
- Publicação automática: criar uma tag `vX.Y.Z` gera a Release com o zip e as notas.

## 1.2.0 — 2026-10-20

### Novidades
- **Atualização com um clique**: o app avisa quando sai uma versão nova e se atualiza sozinho, conferindo o SHA-256 do download.
- **Tela de configurações** (botão ⚙): minimizar ao fechar e procurar atualizações.
- O painel passa a mostrar só as **barras** de uso; o modo em anéis foi removido.

## 1.1.0 — 2026-10-20

### Novidades
- Modo compacto em barras horizontais, agora o padrão.
- O painel se ajusta sozinho à altura do conteúdo.
- Instalador (`instalar.ps1`), ícone próprio e nome "LimitBar" nas notificações.

## 1.0.0 — 2026-10-20

- Primeira versão: faixa sobre a barra de tarefas com os limites de 5h e semanal do Claude e do Codex, painel colado na barra, ritmo de consumo e notificações em 80% e 95%.
