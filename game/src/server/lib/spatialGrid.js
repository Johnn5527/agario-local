'use strict';

/**
 * Grade espacial uniforme para consultas de vizinhança.
 * Células de tamanho `cellSize` no mapa [0..width) x [0..height).
 */
class SpatialGrid {
  constructor(width, height, cellSize) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) {
      this.buckets[i] = [];
    }
  }

  clear() {
    for (let i = 0; i < this.buckets.length; i++) {
      this.buckets[i].length = 0;
    }
  }

  _clampCol(c) {
    return Math.max(0, Math.min(this.cols - 1, c));
  }

  _clampRow(r) {
    return Math.max(0, Math.min(this.rows - 1, r));
  }

  _index(col, row) {
    return row * this.cols + col;
  }

  insert(entity, index) {
    const col = this._clampCol(Math.floor(entity.x / this.cellSize));
    const row = this._clampRow(Math.floor(entity.y / this.cellSize));
    this.buckets[this._index(col, row)].push(index);
  }

  /**
   * Retorna índices candidatos numa região circular (célula + raio).
   * Percorre as células da grade que intersectam o AABB do círculo.
   */
  queryCircle(x, y, radius, out) {
    out.length = 0;
    const minCol = this._clampCol(Math.floor((x - radius) / this.cellSize));
    const maxCol = this._clampCol(Math.floor((x + radius) / this.cellSize));
    const minRow = this._clampRow(Math.floor((y - radius) / this.cellSize));
    const maxRow = this._clampRow(Math.floor((y + radius) / this.cellSize));
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const bucket = this.buckets[this._index(c, r)];
        for (let i = 0; i < bucket.length; i++) {
          out.push(bucket[i]);
        }
      }
    }
    return out;
  }

  /**
   * Para cada par de buckets vizinhos (e o mesmo), chama callback(i, j)
   * com índices de entidades — útil pra colisão player×player sem O(n²) global.
   * Aqui usamos insert de "marcadores" com playerIndex.
   */
}

module.exports = { SpatialGrid };
