# Agar.io (local)

Clone open-source do Agar.io + bots alimentadores (uso local / LAN).

## Como jogar (nesta máquina)

### 1. Servidor do jogo

```bash
cd game
npm install
npm start
```

Abra http://localhost:3000 no navegador. No menu, escolha o nome, a cor e a **massa inicial** (10–5000) antes de jogar.

### 2. Painel de bots (opcional)

```bash
cd bots
npm start
# ou com terminal interativo: npm run bots
```

- Web: http://localhost:3001/ (controles em tempo real + WebSocket)
- No menu do jogo: **Bots alimentadores** → **Chamar bots**
- Detalhes dos atalhos: `bots/README.md` → **Painel de Controle**

## Controles

- Mouse / toque — mover
- `W` — soltar massa
- Espaço — dividir
- `Backspace` — reunir todas as células na hora (force merge; cooldown ~1,5s)

---

## Zoom da câmera

Antes o cliente desenhava **1:1** (mundo = pixels da tela): a célula crescia e ocupava a tela sem afastar a câmera. Agora o zoom acompanha a massa em tempo real (curva **A2**).

### Fórmula

\[
\text{targetScale} = \mathrm{clamp}\!\left(
  \texttt{baseZoom}\cdot\left(\frac{\texttt{refMass}}{m}\right)^{\texttt{zoomMassFactor}},\;
  \texttt{minZoom},\;
  \texttt{maxZoom}
\right)
\]

Com suavização por frame: `scale += (target - scale) * zoomSmoothing`.

No **split**, se o bounding box das células não cabe no viewport, a câmera afasta um pouco mais (até `minZoom`).

Parâmetros em `game/src/client/js/zoom.js` → `ZOOM_CONFIG`:

| Parâmetro | Valor A2 | Significado |
|-----------|----------|-------------|
| `baseZoom` | `1.0` | Scale na massa mínima |
| `minZoom` | `0.28` | Mais afastado (piso) |
| `maxZoom` | `1.10` | Mais próximo (teto) |
| `zoomMassFactor` | `0.30` | Quão forte a massa afasta |
| `refMass` | `10` | Massa de referência |
| `zoomSmoothing` | `0.08` | Velocidade da transição |

### Tabela (antes × A2)

| Massa | Scale antigo | Scale A2 | Área vista (relativa) |
|------:|-------------:|---------:|----------------------:|
| 10 | 1.00 | 1.00 | 1,0× |
| 50 | 1.00 | 0.62 | ~2,6× |
| 100 | 1.00 | 0.50 | ~4,0× |
| 250 | 1.00 | 0.38 | ~6,9× |
| 500 | 1.00 | 0.31 | ~10,5× |
| 1000+ | 1.00 | 0.28 (piso) | ~12,8× |

### Visão do servidor (fog of war)

O servidor filtra entidades com `screenWidth`/`screenHeight`. O cliente envia a **área efetiva** `janela / scale` via `windowResized`, para as bordas da câmera afastada não ficarem vazias.

Se você mudar `minZoom` / `zoomMassFactor`, o sync de visão acompanha automaticamente. Spectate (“Assistir”) usa outra escala (mapa inteiro na janela) e não passa por essa curva.

---

## Performance

### Diagnóstico (números reais neste ambiente)

Medido com `/api/perf` + `game/scripts/bench-perf.js` após as otimizações, mapa com ~3000 comidas, `networkUpdateFactor=20`:

| Bots | tickGame avg | tickGame max | sendUpdates avg | Payload médio | food scans/tick |
|------|--------------|--------------|-----------------|---------------|-----------------|
| 0    | **0,49 ms**  | 1,5 ms       | ~0 ms           | —             | 0               |
| 4    | **0,52 ms**  | 1,3 ms       | **1,2 ms**      | ~35 KB        | ~48             |
| 10   | **0,52 ms**  | 1,1 ms       | **3,3 ms**      | ~37 KB        | ~80             |
| 20   | **0,47 ms**  | 1,0 ms       | **5,0 ms**      | ~32 KB        | ~104            |

Orçamento do tick de física (60 Hz): **16,67 ms**. Com 20 bots o tick ficou ~30× abaixo do orçamento.

**Causa raiz principal (antes):** em `tickPlayer`, cada célula varria **todas** as comidas (`util.getIndexes` em até 3000 itens) a 60 Hz. Com 20 bots ≈ `20 × 3000 = 60.000` testes/tick só de comida. Colisão PvP também era O(n²) em `handleCollisions`.

**Causa secundária:** `networkUpdateFactor: 40` (40 Hz de `serverTellPlayerMove`) × payloads de dezenas de KB por jogador. Com muitos bots, `sendUpdates` escala com N.

**Cliente:** já usava `requestAnimationFrame`; o desenho não fazia culling extra (desenhava tudo que o servidor mandava como “visível”).

### O que foi otimizado

1. **Grade espacial** (`spatialCellSize: 200`) para comida, massFood, vírus e PvP — só testa vizinhos.
2. **Rede 40→20 Hz** + **interpolação** no cliente entre pacotes (movimento mais suave com menos updates).
3. **Culling** no canvas (não desenha fora da tela).
4. **Bots:** `TICK_MS` 120→150, fase por índice do swarm + stagger no start (carga espalhada no tempo).

Endpoint de medição: `GET http://localhost:3000/api/perf`

### Recomendação forceMerge

Cooldown de **1,5s** entre usos (`forceMergeCooldownMs`). Em LAN casual evita o exploit split→merge infinito sem tornar a tecla “inútil”. Ajuste em `game/config.js` se quiser.
---

## Jogando em rede local (LAN)

Qualquer celular ou PC na **mesma Wi-Fi** pode jogar só abrindo um link no navegador. **Não** expõe o jogo na internet pública — só na sua rede.

### Pré-requisitos

1. Servidor rodando com `host: "0.0.0.0"` (já está assim no `game/config.js`).
2. Porta **3000/TCP** liberada no firewall desta máquina.
3. Todos no mesmo Wi-Fi (rede de convidados às vezes isola dispositivos — use a rede principal).

### 1. Descobrir o IP da sua máquina

**Windows (PowerShell ou CMD):**

```bat
ipconfig
```

Procure **Endereço IPv4** do adaptador Wi-Fi/Ethernet (ex.: `192.168.1.101`).

**Linux:**

```bash
ip addr
# ou
hostname -I
```

**macOS:**

```bash
ifconfig
# ou
ipconfig getifaddr en0
```

Ao subir o servidor (`npm start`), o console também imprime a URL LAN e um **QR code**.

### 2. Liberar o firewall (Windows)

Abra o **PowerShell como Administrador** e rode:

```powershell
cd "C:\Users\Johnn\Downloads\MEU REPOSITORIO\Agar.io"
.\scripts\abrir-firewall-lan.ps1
```

Ou manualmente:

```powershell
netsh advfirewall firewall add rule name="Agar.io Clone LAN 3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="Agar.io Bots Panel 3001" dir=in action=allow protocol=TCP localport=3001
```

**Linux (ufw):**

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 3001/tcp
```

**macOS:** Ajustes → Rede → Firewall → permitir Node, ou liberar a porta 3000.

### 3. Abrir o link / QR code

1. Na máquina host:
   - `cd game && npm run start:server` (após um `npm start`/`gulp build` ter gerado `bin/`)
   - ou `cd game && npm start`
2. No console aparece: `http://192.168.x.x:3000` + QR em ASCII
3. Também é gerado `game/lan-qr.png` — abra e mostre na tela
4. No celular: câmera → escanear QR → abrir no navegador
5. Digite um nome, escolha a massa inicial e toque em **Jogar**

Para só regenerar o QR sem reiniciar:

```bash
cd game
node -e "require('./src/server/lib/lan').printLanInvite(3000)"
```

O client usa `io()` **sem URL fixa** (mesmo host da página). Socket.io está com CORS `origin: "*"`. jQuery é servido localmente (sem CDN).

### 4. Testar

No celular/outro PC da Wi-Fi:

- [ ] A página carrega
- [ ] Dá para entrar com um nick
- [ ] Movimento e ações funcionam (no mobile: botões split/feed)

Se a página não carregar: confira IP, firewall e se o celular está na mesma rede.

### 5. Bots apontando para o IP da LAN

Por padrão os bots usam `http://localhost:3000`. Se o servidor estiver em outra máquina da rede:

```bash
cd bots
node panel-server.js --server http://192.168.1.101:3000
# ou
node index.js --server http://192.168.1.101:3000 --target Johnny --count 4
```

Variáveis de ambiente:

```bash
set SERVER_URL=http://192.168.1.101:3000
set TARGET_PLAYER_NAME=Johnny
set BOT_COUNT=4
npm start
```

(No PowerShell: `$env:SERVER_URL="http://192.168.1.101:3000"`.)

---

## Modo sacrifício

Além de soltar massa com `W` (trickle), os bots podem **se deixar ser comidos** de propósito, entregando a massa inteira de uma vez.

### Regra REAL de “comer” neste clone

No agar.io clássico costuma ser `massA >= massB * 1.25`. **Este clone é diferente.**

Em `game/src/server/map/player.js` → `Cell.checkWhoAteWho`:

- A come B **somente** se o círculo de B está **totalmente dentro** do círculo de A (`SAT` `response.bInA`).
- Não há razão 1.25 para PvP.
- Com centros quase juntos, isso ≈ `mass(A) > mass(B)` (via `radius = 4 + sqrt(mass)*6`).

Por isso a config usa `SERVER_EAT_MASS_RATIO = 1.0` (piso) e a folga vem de `SACRIFICE_SAFETY_MARGIN` (padrão **1.5**):

```text
meuMass >= botMass * 1.0 * SACRIFICE_SAFETY_MARGIN
```

**Não diminua a margem** sem entender essa regra — margem baixa demais e o bot encosta sem ser engolido; conta invertida e o bot poderia te comer.

### Config (`bots/config.js` ou env/CLI)

| Chave | Padrão | Significado |
|-------|--------|-------------|
| `FEEDING_MODE` | `hybrid` | `trickle` / `sacrifice` / `hybrid` |
| `SACRIFICE_SAFETY_MARGIN` | `1.5` | Folga sobre a razão 1.0 |
| `SACRIFICE_MIN_BOT_MASS` | `40` | Só sacrifica bots com massa ≥ isto |

```bash
cd bots
node index.js --mode hybrid --target Johnny --count 4
# ou
set FEEDING_MODE=hybrid
set SACRIFICE_SAFETY_MARGIN=1.5
```

No modo **hybrid**: bots pequenos usam W; bots grandes, com folga confirmada a cada tick e sem ameaça no caminho, entram em `SACRIFICING` e vão ao seu centro. Se sua massa cair no meio do caminho, **abortam**.

### Testes

```bash
cd bots
npm test                  # unitários da conta de segurança
npm run test:integration  # contra servidor local em :3000
```

### Fake player que cresce

```bash
node test/fake_player.js JohnnyTeste --hunt-food
node test/fake_player.js JohnnyTeste --hunt-food --force-drop-at=80
```

---

## Licença

Este projeto é distribuído sob a **Licença MIT** — veja [`LICENSE`](LICENSE).
Direitos autorais (c) 2026 Johnny lucas.

### Componentes de terceiros

`game/` é derivado de [owenashurst/agar.io-clone](https://github.com/owenashurst/agar.io-clone),
também sob Licença MIT, Copyright (c) 2015, Huy Tran. O aviso original está em
[`game/LICENSE`](game/LICENSE) e precisa ser mantido em cópias desse código.
