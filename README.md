# LimitBar

**Seus limites de 5 horas e semanal do Claude e do Codex, sempre visíveis na barra de tarefas do Windows (ou na bandeja do sistema, no Linux).**

No Windows, uma faixa pequena sobre a barra de tarefas mostra quanto você já usou de cada janela. No Linux não existe um equivalente único de "barra de tarefas" entre GNOME, KDE, XFCE etc., então a interface é um ícone de bandeja comum com a mesma informação no tooltip. Nos dois casos, um clique abre o mesmo painel com barras de progresso, tempo até o reset e ritmo de consumo.

<p align="center">
  <img src="docs/faixa.png" alt="Faixa sobre a barra de tarefas com as quatro porcentagens" height="48">
</p>

<table align="center">
  <tr>
    <td align="center" valign="top"><img src="docs/barras.png" alt="Painel com as quatro barras de uso" width="270"><br><sub><b>Painel</b></sub></td>
    <td align="center" valign="top"><img src="docs/configuracoes.png" alt="Configurações em seções recolhíveis" width="270"><br><sub><b>Configurações</b> (⚙)</sub></td>
    <td align="center" valign="top"><img src="docs/primeiro-uso.png" alt="Boas-vindas e mensagens de primeiro uso" width="270"><br><sub><b>Primeiro uso</b></sub></td>
  </tr>
</table>

<sub>Os números das capturas são ilustrativos.</sub>

## Recursos

- **Faixa na barra de tarefas** (Windows) ou **ícone de bandeja** (Linux) com Claude e Codex (5h e semanal). Na faixa do Windows: âmbar a partir de 70%, vermelho com ⚠ a partir de 90%; a borda acompanha a pior janela. Arraste pela alça `⋮⋮` para posicionar.
- **Painel** com barras de progresso, marcador de ritmo (onde você *deveria* estar) e horário do reset ao passar o mouse.
- **Previsão de esgotamento**: "no ritmo atual, o limite acaba hoje às 14:32".
- **Alertas do sistema** configuráveis (50 a 95%, aviso de reset, silenciar por serviço).
- **Tema** Sistema, Claro ou Escuro (com fundo acrílico no Windows 11).
- **Atualização com um clique** no Windows, com conferência SHA-256 (no Linux, baixe o `.tar.gz` manualmente — ver [Atualizações](#atualizações)).
- **Janela de 5h automática** (opcional, desligada por padrão): veja [abaixo](#janela-de-5h-automática-opcional).
- **Renovação automática do login do Claude** (pode ser desligada).
- **Iniciar com o sistema** e mensagens de primeiro uso que dizem o que fazer se faltar o Claude Code ou o Codex.
- Acessível: teclado (`Esc`, `F5`, `Ctrl+,`), leitores de tela, contraste verificado por teste e sem animações se o sistema pedir.

## Requisitos

- Windows 11, ou Linux com GNOME/KDE/XFCE (precisa de suporte a ícone de bandeja — em GNOME puro, uma extensão como o [AppIndicator](https://extensions.gnome.org/extension/615/appindicator-support/))
- Claude Code e/ou Codex CLI instalados e logados no mesmo usuário do sistema
- [Node.js](https://nodejs.org) 18+ (só para instalar a partir do código)

## Instalação

### Windows

**Pronto, sem Node.js:** baixe o `LimitBar-win32-x64.zip` na [página de Releases](https://github.com/igorfggomes/limitbar/releases/latest), extraia e abra o `LimitBar.exe`. O executável não é assinado, então o SmartScreen pode avisar: **Mais informações → Executar assim mesmo**.

**A partir do código** (cria atalhos e instala em `%LOCALAPPDATA%\Programs\LimitBar`):

```powershell
git clone https://github.com/igorfggomes/limitbar.git
cd limitbar
powershell -ExecutionPolicy Bypass -File instalar.ps1
```

### Linux

**Pronto, sem Node.js:** baixe o `LimitBar-linux-x64.tar.gz` na [página de Releases](https://github.com/igorfggomes/limitbar/releases/latest), extraia e rode o executável `LimitBar` de dentro da pasta.

**A partir do código** (instala em `~/.local/opt/LimitBar` e cria entrada no menu de aplicativos):

```bash
git clone https://github.com/igorfggomes/limitbar.git
cd limitbar
bash instalar.sh
```

### Rodar direto do código (qualquer SO)

`npm install` e `npm start`.

## Uso

| Ação | Resultado |
|---|---|
| Clique na faixa (Windows) / no ícone da bandeja (Linux) | Abre ou fecha o painel |
| ⚙ no painel | Configurações: tema, alertas, janela de 5h, login do Claude, atualizações |
| Clique direito na faixa/ícone | Menu: atualizar, minimizar ao fechar, manter aberto, iniciar com o sistema, sair |
| Arrastar `⋮⋮` (só Windows) | Move a faixa (posição salva) |

## Como funciona

| Serviço | De onde vêm os dados |
|---|---|
| **Claude** | O token do Claude Code (`~/.claude/.credentials.json`) consulta o endpoint de uso do `/usage`. |
| **Codex** | Os logs de sessão em `~/.codex/sessions` (`rate_limits`). Só atualiza depois que você usa o Codex. |

O token vai apenas para a Anthropic (`api.anthropic.com` e, para renovar, `platform.claude.com`) e nunca é registrado em log nem copiado para outro lugar. O app consulta no máximo a cada 2,5 minutos, respeita o `Retry-After` do HTTP 429 e, em falhas, mantém o último valor bom.

**Renovação do login.** Os tokens de renovação do Claude são rotativos. Se o token expirou, o LimitBar renova e **grava o resultado no arquivo de login do Claude Code**, só se o token no disco ainda for o que ele usou (se o Claude Code renovou antes, nada é sobrescrito), de forma atômica e sem insistir por 10 minutos se o servidor recusar. Para o LimitBar nunca escrever nesse arquivo, desligue **Renovar o login sozinho** em ⚙ → Claude.

> **Aviso:** ferramenta não oficial, sem vínculo com a Anthropic ou a OpenAI. O endpoint de uso do Claude e o formato dos logs do Codex não são APIs públicas e podem mudar sem aviso.

## Janela de 5h automática (opcional)

As janelas de 5 horas só começam na primeira mensagem. Com **⚙ → Janela de 5h → Iniciar a janela sozinho**, o LimitBar detecta uma janela parada e envia **uma mensagem mínima** pela CLI oficial para a próxima começar. Vale para Claude e Codex, à sua escolha.

Não aumenta o seu limite: só muda *quando* as janelas começam, e cada disparo gasta um pouco do limite semanal. Confira os termos do seu plano sobre uso automatizado. Quem usa chave de API (e não assinatura) não deve ligar.

| Serviço | Comando |
|---|---|
| Claude | `claude -p "Responda apenas: ok" --model haiku --no-session-persistence --tools ""` |
| Codex | `codex exec --skip-git-repo-check -s read-only "Responda apenas: ok"` |

Roda numa pasta temporária vazia, sem variáveis de chave de API, e nunca chama a API direto com o seu token.

- **Teto de custo** (1, 2, 3 ou 5%; padrão 2%): depois de cada disparo o uso é lido de novo; se o custo passar do teto, a função é desligada para aquele serviço e você é avisado. A leitura tem resolução de 1 ponto percentual e inclui outro uso seu no mesmo instante, então o custo pode sair um pouco inflado.
- **Travas**: só dispara com a janela comprovadamente parada (leitura duvidosa nunca dispara); espera 1 minuto após abrir o app e 12 após um disparo; falhas aumentam a espera (10 a 120 min); no máximo 3 tentativas por janela parada e 8 por dia, por serviço.
- **Testar agora** envia uma mensagem a cada serviço marcado (com confirmação) e mostra o custo medido.
- **Validação**: nos dois serviços, em uso real, os comandos terminaram com sucesso e o custo ficou entre 0% e 1%. No Codex a criação de uma janela nova foi observada; no Claude, não foi isolada (a janela já estava ativa).

## Atualizações

O LimitBar consulta as [Releases](https://github.com/igorfggomes/limitbar/releases) ao abrir e a cada 6 horas. Havendo versão nova, aparece um **⬆** na faixa; **Atualizar agora** baixa o zip, confere o SHA-256, troca os arquivos e reabre o app. Se algo falhar, a versão atual é mantida e suas configurações não são tocadas. Funciona no app empacotado em pasta com permissão de escrita; nos demais casos, abre a página da Release. Dá para procurar na hora (⚙) ou desligar a verificação automática (menu da faixa). **No Linux a atualização com um clique ainda não existe** (só existe o pacote `.zip` do Windows); a verificação avisa que há versão nova e abre a página da Release pra baixar o `.tar.gz` manualmente.

## Limitações

- No Windows, a faixa é uma janela posicionada sobre a barra de tarefas (o Windows 11 não permite desenhar dentro dela) e é reerguida quando a barra vem para a frente. No Linux não há faixa — a interface é um ícone de bandeja, sem a mesma visibilidade constante.
- "Iniciar com o sistema" no Linux grava um `.desktop` em `~/.config/autostart` (padrão XDG); não foi testado em todo ambiente de desktop.
- Testado em um monitor, com a barra embaixo (Windows) / num só monitor (Linux).

## Desenvolvimento

```powershell
npm install
npm test        # testes automáticos
npm run test:ui # verificações da interface num Electron oculto
npm start
```

O GitHub executa os testes a cada `push` e `pull request` (Node 20 e 24, Windows e Linux) e empacota os dois sistemas pra pegar regressão de empacotamento cedo.

**Publicar uma versão:** aumente `version` no `package.json`, acrescente `## X.Y.Z` no `CHANGELOG.md`, faça o commit e rode `git tag vX.Y.Z && git push origin main vX.Y.Z`. O fluxo **Release** roda os testes, empacota pra Windows e Linux e publica o zip/tar.gz de cada um com o `.sha256` e as notas do CHANGELOG. Tags com hífen (`v1.4.0-beta.1`) saem como pré-lançamento e não são oferecidas pela atualização automática.

## Licença

[MIT](LICENSE)
