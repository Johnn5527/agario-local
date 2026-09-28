'use strict';

// Gera uma lista de pontos (centros de célula da grade) cobrindo o mapa
// inteiro em zigue-zague: vai da esquerda pra direita numa linha, desce,
// volta da direita pra esquerda na próxima, e assim por diante. Isso
// garante cobertura completa sem repetir trechos à toa.
function buildSweepPath(gameWidth, gameHeight, cellWidth, cellHeight) {
  const cols = Math.max(1, Math.ceil(gameWidth / cellWidth));
  const rows = Math.max(1, Math.ceil(gameHeight / cellHeight));

  const points = [];
  for (let row = 0; row < rows; row++) {
    const y = Math.min(gameHeight - 1, row * cellHeight + cellHeight / 2);
    const colsOrder = row % 2 === 0
      ? [...Array(cols).keys()]
      : [...Array(cols).keys()].reverse();

    for (const col of colsOrder) {
      const x = Math.min(gameWidth - 1, col * cellWidth + cellWidth / 2);
      points.push({ x, y });
    }
  }
  return points;
}

module.exports = { buildSweepPath };
