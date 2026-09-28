'use strict';

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(vec) {
  const len = Math.hypot(vec.x, vec.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: vec.x / len, y: vec.y / len };
}

// Vetor unitário de "from" apontando para "to"
function direction(from, to) {
  return normalize({ x: to.x - from.x, y: to.y - from.y });
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(vec, factor) {
  return { x: vec.x * factor, y: vec.y * factor };
}

// Combina vários vetores de "vontade" (aproximar, fugir, etc.) já ponderados
function combine(vectors) {
  const sum = vectors.reduce((acc, v) => add(acc, v), { x: 0, y: 0 });
  return normalize(sum);
}

module.exports = { distance, normalize, direction, add, scale, combine };
