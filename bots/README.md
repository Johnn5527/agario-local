# Bots Alimentadores — Agar.io Clone (uso local/educacional)

⚠️ **Isso só funciona contra um clone open-source do Agar.io rodando na SUA
máquina.** Não conecta e não deve ser adaptado para conectar no servidor
oficial do agar.io ou de qualquer jogo `.io` real — isso violaria os termos
de uso e pode banir contas. O valor aqui é 100% de aprendizado técnico
(protocolo websocket, máquina de estados, IA de agentes).

## O que é

Um enxame de bots em Node.js que entra num clone local do Agar.io
(`owenashurst/agar.io-clone`) e alimenta automaticamente um jogador
específico (você), com:

- **Busca sistemática**: os bots varrem o mapa em grade (padrão
  "cortador de grama"), divididos entre si, até encontrar você.
- **Aproximação e alimentação**: ao te encontrar, mantêm uma órbita segura
  ao seu redor (nunca encostam na sua célula, pra não serem comidos sem
  querer) e soltam massa (`W`) na sua direção quando têm massa suficiente.
- **Split para alimentar mais rápido**: quando um bot acumula massa alta o
  bastante, ele se divide antes de soltar comida — cada metade acima do
  mínimo solta massa junto, dobrando a entrega por disparo.
- **Fuga de ameaças**: se outro jogador (bot ou humano) maior o bastante
  pra comer o bot aparece perto, o bot foge, ignorando a alimentação até a
  ameaça passar.
- **Reconexão e respawn automáticos**: se um bot cair ou morrer, ele volta
  sozinho, sem precisar reiniciar nada manualmente.

## Passo a passo

### 1. Suba o servidor do jogo localmente

```bash
git clone https://github.com/owenashurst/agar.io-clone.git
cd agar.io-clone
npm install
node src/server/server.js
```

O servidor sobe em `http://localhost:3000`. Abra essa URL no navegador,
escolha um nome (esse é o nome que você vai colocar em `TARGET_PLAYER_NAME`
no passo 3) e entre no jogo normalmente — esse é o "você" que os bots vão
alimentar.

### 2. Instale as dependências dos bots

Em outra pasta/terminal:

```bash
cd agario-feeder-bots
npm install
```

### 3. Configure o alvo

Abra `config.js` e ajuste pelo menos:

```js
TARGET_PLAYER_NAME: 'SeuNomeNoJogo',  // EXATAMENTE como você digitou no navegador
BOT_COUNT: 4,                          // quantos bots alimentadores
```

### 4. Rode os bots

```bash
# Com painel terminal (atalhos) + web em :3001
npm run bots
# ou: node index.js
```

O terminal mostra o status e aceita atalhos (`?` lista tudo). O painel web
fica em http://localhost:3001/. Pra parar: `q` ou `Ctrl+C`.

Detalhes: seção **Painel de Controle** abaixo.
## Sobre a velocidade da alimentação

Com a configuração padrão do clone (pouca comida no mapa, mapa de
5000×5000), ganhar massa é **lento por padrão do próprio jogo** — não é bug
dos bots. Um bot recém-entrado tem massa 10 e só consegue soltar comida (W)
a partir de massa 30 (`defaultPlayerMass + fireFood`, ambos configuráveis
no servidor). Nos meus testes, isso levou alguns minutos por bot.

Se quiser algo mais rápido pra testar/demonstrar, edite o `config.js` **do
servidor** (`agar.io-clone/config.js`, não o dos bots) e reinicie o
servidor:

```js
foodMass: 1,        // aumente (ex: 3) para cada comida valer mais massa
maxFood: 1000,       // aumente (ex: 3000) para ter mais comida no mapa
gameMass: 20000,     // orçamento total de massa do jogo; aumente junto com maxFood
```

## ⚠️ Status atual (leia antes de confiar cegamente no sistema)

O que **já foi validado rodando o servidor local de verdade**:
- Conexão, handshake (`welcome`→`gotit`), entrada no mapa, respawn automático.
- Estado `EXPLORING`: os bots varrem o mapa em grade e ganham massa
  comendo comida sozinhos (confirmado por logs: massa subindo de forma
  consistente ao longo de vários minutos).
- Detecção do alvo por nome (`APPROACHING` disparando corretamente quando
  o alvo entra no campo de visão, inclusive em ~15s num dos testes graças
  à busca em grade).
- Estado `EVADING` disparando quando outro jogador maior aparece perto
  (inclusive entre os próprios bots — ver limitação abaixo).

O que **NÃO cheguei a confirmar ao vivo, e precisa ser validado antes de
confiar 100% no sistema**:
- Que um bot realmente cruza o limiar de massa mínima (30) e que o
  `socket.emit("1")` realmente é disparado.
- Que, depois disso, a massa do jogador-alvo real sobe de fato.

Nos testes que rodei, a massa dos bots crescia de forma consistente mas
lenta (ex: de 13 para 18-22 ao longo de vários minutos, competindo por
comida escassa com outros bots e o próprio alvo) e não cheguei a
acompanhar em tempo real até ela cruzar 30. A lógica está implementada e
devidamente comentada no código (`bot.js`, método `_tryFeed`), mas o "vi
funcionando de ponta a ponta com meus próprios olhos" ainda está pendente.
**Recomendo rodar por 10-15 minutos reais (ou acelerar a economia de
comida do servidor — ver seção abaixo) e confirmar isso antes de usar o
sistema "de verdade".**

## Histórico de depuração (bugs já encontrados e corrigidos)

Documentado aqui pra caso precise depurar de novo no futuro, ou pra saber
exatamente o que já foi tentado:

1. **Versão errada do socket.io-client.** Tentei inicialmente
   `socket.io-client@1.7.4` assumindo (com base numa busca desatualizada)
   que o servidor fosse antigo. O servidor real (`owenashurst/agar.io-clone`)
   usa **socket.io v4.6.1**. A versão errada causava "xhr poll error" e
   timeouts silenciosos de conexão. Corrigido trocando para
   `socket.io-client@4.6.1` e passando `query` como objeto
   (`{type:"player"}`), não como string.
2. **Bug de guarda em `_handleDrop()`.** A função só tentava reconectar se
   `this.connected` já fosse `true` — então uma falha na CONEXÃO INICIAL
   (`connect_error`) era silenciosamente ignorada e o bot ficava travado
   pra sempre em `CONNECTING`, sem log nenhum explicando por quê. Corrigido
   com uma flag `_reconnecting` independente de `connected`, mais uma flag
   `_stopping` pra não tentar reconectar quando o desligamento é
   intencional (Ctrl+C).
3. **Script de teste sem heartbeat.** `test/fake_player.js` não mandava o
   evento `"0"` (heartbeat de movimento) — o servidor derruba qualquer
   jogador que fica mais de `maxHeartbeatInterval` (5s por padrão) sem
   mandar isso. O "jogador-alvo simulado" estava sendo kickado quase
   instantaneamente, e o script continuava reimprimindo a última massa
   conhecida como se ele ainda estivesse no jogo — o que me fez achar, por
   um tempo, que os bots simplesmente não encontravam o alvo. Corrigido
   mandando um heartbeat a cada 1s e logando `kick`/`disconnect`.
4. **Busca aleatória ineficiente.** A primeira versão do `EXPLORING`
   escolhia um ponto 100% aleatório em todo o mapa (5000×5000) a cada
   novo destino — extremamente ineficiente, os bots podiam levar muito
   tempo por puro azar pra cruzar com o alvo. Substituído por uma
   varredura sistemática em grade (`lib/sweepPath.js`, padrão
   "cortador de grama"/boustrophedon), com cada bot cobrindo um trecho
   diferente do mapa em paralelo.
5. **Órbita "travada" no estado `PREPARING`.** Quando o bot chega perto do
   alvo mas ainda não tem massa suficiente pra alimentar (mínimo 30), a
   primeira versão o fazia orbitar o alvo incrementando um ângulo bem
   pequeno a cada tick. Na prática, o "próximo destino" mal se movia de um
   tick pro outro, e o próprio servidor amortece a velocidade quando o
   alvo de movimento está muito perto (regra de proximidade em
   `player.js`) — o bot ficava girando manso, quase parado, sem cobrir
   território novo pra achar comida, e a massa nunca crescia. Uma segunda
   tentativa com waypoints discretos ao redor de um círculo também não
   resolveu de forma confiável (o raio da órbita nem sempre cruza onde a
   comida realmente está). **Solução final**: enquanto a massa está abaixo
   do mínimo, `PREPARING` simplesmente reaproveita a mesma varredura em
   grade do `EXPLORING` — o bot só passa a perseguir o alvo de verdade
   quando já tem massa suficiente pra alimentar.
6. **"Estagnação" que na real era só lentidão.** Cheguei a suspeitar de bug
   quando a massa de um bot ficava "parada" em janelas de 1-2 minutos de
   observação. Confirmei que não é bug: com `foodMass:1` e `maxFood:1000`
   padrão do servidor, e vários bots + o alvo competindo pela mesma comida
   escassa num mapa de 5000×5000, o ganho de massa é genuinamente lento.
   Ver seção "Sobre a velocidade da alimentação" acima pra acelerar isso.

## Limitações conhecidas

- **Bots podem fugir uns dos outros**: como cada bot só enxerga "jogadores"
  (sem saber quem é bot ou humano), um bot maior que outro pode disparar a
  fuga do menor. Cosmético, não quebra a alimentação — só desperdiça um
  pouco de tempo. Pra eliminar isso, seria preciso um canal separado entre
  os bots pra "se reconhecerem" (ex: todos com prefixo de nome + lista de
  IDs próprios compartilhada em memória, já que rodam no mesmo processo).
- **Nome do alvo é uma string fixa**: se dois jogadores tiverem o mesmo
  nome no servidor, os bots vão alimentar o primeiro que encontrarem com
  esse nome. Dá pra trocar o alvo em tempo real pelo painel (`t` / UI web)
  sem reiniciar o processo.
- **Painel terminal + web**: o mesmo estado do enxame é controlado pelo
  terminal (atalhos) e por http://localhost:3001/ (WebSocket). Ver seção
  **Painel de Controle** abaixo.

## Painel de Controle

O painel é a **camada de controle** sobre a IA dos bots (máquina de estados
intacta). Config “viva” em memória: mudanças valem no próximo tick, sem
reiniciar o Node.

### Como subir

```bash
# Terminal interativo + painel web (recomendado pra debug)
npm run bots
# ou: node index.js --target Johnny --count 4 --mode hybrid

# Só API/web (o botão "Chamar bots" do jogo usa isso)
npm start
# ou: node panel-server.js --server http://localhost:3000
```

- **Terminal**: atalhos enquanto o processo roda (precisa de TTY).
- **Web**: http://localhost:3001/ (porta `BOTS_PANEL_PORT`)
- Terminal e web compartilham o **mesmo** `swarm` — ações numa interface
  aparecem na outra via WebSocket.

### Atalhos do terminal

| Tecla | Ação |
|-------|------|
| `p` | Pausar / retomar **todo** o enxame (conectados, sem se mover) |
| `+` / `-` | Adicionar / remover um bot (rebalanceia a varredura em grade) |
| `t` | Trocar `TARGET_PLAYER_NAME` (prompt) |
| `m` | Trocar `FEEDING_MODE` (`trickle` / `sacrifice` / `hybrid`) |
| `b` | Definir `BOT_COUNT` exato (0–20) |
| `d` | Ajustar `APPROACH_DISTANCE` / `FEED_DISTANCE` / `MIN_SAFE_DISTANCE` |
| `s` | Estatísticas agregadas + linha do tempo de eventos |
| `l` | Alternar painel resumido ↔ detalhado (histórico de estados) |
| `i` | Selecionar bot por índice ou nome |
| `e` | Force explore (reset da varredura) no bot selecionado |
| `f` | Freeze / unfreeze no bot selecionado |
| `x` | Force sacrifice (ignora massa mínima uma vez) |
| `r` | Soft-reconnect só daquele bot |
| `?` | Lista de atalhos |
| `q` | Encerrar com `stop()` em cada bot |

### Painel web

Abra http://localhost:3001/ para:

- Cards por bot (cor por estado) com Freeze / Explore / Sacrifice / Reconnect / Remover
- Contador de massa estimada entregue (W + sacrifícios)
- Gráfico em `<canvas>` da massa do alvo ao longo do tempo
- Formulários para alvo, modo, quantidade e distâncias
- Atualização em tempo real via `ws://localhost:3001/ws`

API REST (compatível com o menu do jogo):

- `GET /api/status`
- `POST /api/start` `{ target, count, feedingMode?, server? }`
- `POST /api/stop`
- `POST /api/command` `{ cmd, ... }` — mesmos comandos do WebSocket

### Estatísticas (`s` / UI)

- Massa total estimada entregue (disparos W × `FIRE_FOOD_MASS` + massa dos sacrifícios)
- Tempo médio do nascimento até massa suficiente pra alimentar
- Mortes / respawns por bot e no total
- Últimos ~30 eventos (feed, death, state, pause, config, …)

### Hot-reload (sem reiniciar)

Editáveis em tempo real (objeto `config` compartilhado; bots leem `this.cfg` a cada tick):

- `TARGET_PLAYER_NAME`, `BOT_COUNT`, `FEEDING_MODE`
- `SACRIFICE_SAFETY_MARGIN`, `SACRIFICE_MIN_BOT_MASS`
- `APPROACH_DISTANCE`, `FEED_DISTANCE`, `MIN_SAFE_DISTANCE`

Não persiste em disco (só memória do processo), a menos que você edite `config.js` e reinicie.

## Estrutura do projeto

```
agario-feeder-bots/
├── config.js              # defaults + CLI/env (objeto mutável em runtime)
├── bot.js                 # FeederBot: IA + pause/freeze/controls
├── swarm.js               # enxame compartilhado (terminal + web)
├── index.js               # sobe bots + terminal + painel web
├── panel-server.js        # só painel web/API (jogo chama /api/start)
├── panel/
│   ├── terminal.js        # atalhos readline
│   ├── web.js             # HTTP + WebSocket
│   └── public/            # index.html, styles.css, app.js
├── lib/
│   ├── eventBus.js        # eventos / timeline do painel
│   ├── geometry.js
│   ├── logger.js
│   ├── sacrifice.js
│   └── sweepPath.js
└── test/
```
