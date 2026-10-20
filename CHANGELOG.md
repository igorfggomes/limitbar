# Changelog

As notas de cada versão aparecem na página de [Releases](https://github.com/igorfggomes/limitbar/releases).
O fluxo de publicação usa a seção da versão deste arquivo como texto da Release.

## 1.4.1 — 2026-10-20

### Melhorias
- **Configurações em seções recolhíveis**: cada seção (Janela, Alertas, Janela de 5h, Claude e Atualizações) tem uma seta para expandir e recolher, e **todas começam recolhidas**. A tela passa de cerca de 870 px para 230 px. Com todas abertas, a altura é limitada (cerca de 500 px) e o conteúdo rola por dentro, com o cabeçalho sempre visível.
- Títulos das seções em laranja claro (e laranja escuro no tema claro), com contraste bem maior que o azul de destaque do Windows.

### Tema
- **Escolha do tema** em ⚙ → Aparência: **Sistema** (segue o Windows, como antes), **Claro** ou **Escuro**. A escolha vale na hora e fica salva.
- Quando você força um tema diferente do Windows, o fundo fica mais opaco, porque o vidro do Windows continua com o tom do sistema e o texto perderia contraste.
- No tema claro, o âmbar, o verde e o vermelho de estado ficaram mais escuros: o âmbar e o verde tinham só 2,6:1 e 2,9:1 de contraste (agora acima de 5:1).
- Um teste lê as cores do CSS e falha se algum texto ficar abaixo de 4,5:1 (ou barra abaixo de 3:1) em qualquer tema.

### Exibição das informações
- **Faixa**: cada número ganhou o rótulo `5h` ou `sem`; a partir de 70% fica âmbar, a partir de 90% vermelho com ⚠, e a borda da faixa acompanha a pior janela dos dois serviços.
- **Tooltips da faixa** com serviço, janela, percentual e quando reseta ("Claude · 5 horas: 44% — reseta em 2h 59min").
- **Correção**: mensagem de erro com aspas quebrava o tooltip da faixa; agora o texto é escapado.
- **Painel**: linhas do mesmo serviço ficam mais próximas e há mais espaço entre Claude e Codex (mesma altura total).
- **Rodapé**: mostra "há N min" quando o dado tem mais de 2 minutos e fica âmbar acima de 5 minutos (notebook dormiu, internet caiu).

### Usabilidade e acessibilidade
- **Feedback de estado**: esqueleto de carregamento enquanto a primeira leitura não chega; ao atualizar, o ⟳ gira, o botão fica desabilitado e o rodapé diz "Atualizando…".
- **Leitores de tela**: botões de ícone com nome, cada barra é um `progressbar` com valor e texto ("44%, reseta em 3h 36min"), avisos de atualização anunciados sem roubar o foco.
- **Não depende só de cor**: a partir de 90% aparece um ⚠ ao lado do percentual.
- **Reconhecimento**: legenda do traço branco ("ritmo esperado") no rodapé.
- **Erro com saída**: cada cartão de erro tem o botão "Tentar de novo".
- **Teclado**: Esc fecha o painel (ou volta das configurações), F5 atualiza, Ctrl+, abre as configurações.
- **Notificações**: clicar numa notificação do Windows abre o painel.
- **Cor do texto sobre o destaque do Windows** calculada pelo contraste (nunca branco fixo sobre um destaque claro).
- Alvos de clique maiores (28 px), foco visível em todos os controles e respeito a "reduzir movimento" do Windows.

## 1.4.0 — 2026-10-20

### Novidades
- **Janela de 5h automática (opcional, desligada por padrão)**: quando a janela de 5 horas do Claude ou do Codex fica parada, o LimitBar envia uma mensagem mínima pela CLI oficial para a próxima começar, 24 horas por dia. Em ⚙ → Janela de 5h você escolhe os serviços e o **teto de custo por disparo** (1, 2, 3 ou 5%; padrão 2%).
- **Teto de custo**: depois de cada disparo o custo é medido; se passar do teto, a função é desligada para aquele serviço e você é avisado.
- **Testar agora**: envia uma mensagem a cada serviço marcado, depois de pedir confirmação, e mostra o custo medido.
- A tela de configurações passa a **rolar** em telas baixas, em vez de passar do tamanho da tela.

### Segurança
- Só dispara com a janela comprovadamente parada; leituras duvidosas (rede fora, valor guardado, erro) nunca disparam.
- Espera depois de cada tentativa (crescente se falhar), no máximo 3 tentativas por janela parada e 8 por dia, uma tentativa por vez.
- Os comandos rodam numa pasta temporária vazia e sem as chaves de API do ambiente, para a cobrança nunca sair da API em vez da assinatura.
- Depois do disparo, remove a pasta de projeto vazia que o Claude Code cria para a pasta temporária (nunca apaga pasta com conteúdo).
- Não aumenta o limite: só muda quando as janelas começam, e cada disparo gasta um pouco do limite semanal.

### Por trás
- Testes de mutação para as travas e para a limpeza da janela automática; 132 testes automáticos e 33 verificações de interface, 22 do painel e 11 da faixa (`npm run test:ui`).
- Validada em uso real com Claude e Codex: custo medido de 0% a 1%; no Codex, o disparo criou a janela.

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
