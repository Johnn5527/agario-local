'use strict';

/**
 * Zoom da câmera (curva A2).
 * scale menor = mais afastado (vê mais mapa).
 */
const ZOOM_CONFIG = {
  baseZoom: 1.0,        // scale com massa mínima (refMass)
  minZoom: 0.28,        // mais afastado (massa alta)
  maxZoom: 1.10,        // mais próximo (massa baixa)
  zoomMassFactor: 0.30, // expoente da potência
  refMass: 10,          // defaultPlayerMass
  zoomSmoothing: 0.08,  // lerp por frame (menor = mais suave)
  clusterPadding: 1.15, // folga extra no split pra caber o aglomerado
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function massBasedScale(mass, cfg) {
  const c = cfg || ZOOM_CONFIG;
  const m = Math.max(c.refMass, Number(mass) || c.refMass);
  const raw = c.baseZoom * Math.pow(c.refMass / m, c.zoomMassFactor);
  return clamp(raw, c.minZoom, c.maxZoom);
}

function effectiveMassFromCells(cells, massTotal) {
  let maxMass = 0;
  if (cells && cells.length) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].mass > maxMass) maxMass = cells[i].mass;
    }
  }
  return Math.max(massTotal || 0, maxMass, ZOOM_CONFIG.refMass);
}

/**
 * Se o bounding box do split não cabe no viewport com o scale da massa,
 * afasta mais (sem passar de minZoom).
 */
function applyClusterFit(cells, screenW, screenH, massScale, cfg) {
  const c = cfg || ZOOM_CONFIG;
  if (!cells || cells.length <= 1) return massScale;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const r = cell.radius || 0;
    minX = Math.min(minX, cell.x - r);
    maxX = Math.max(maxX, cell.x + r);
    minY = Math.min(minY, cell.y - r);
    maxY = Math.max(maxY, cell.y + r);
  }

  const spanW = Math.max(1, (maxX - minX) * c.clusterPadding);
  const spanH = Math.max(1, (maxY - minY) * c.clusterPadding);
  const fitScale = Math.min(screenW / spanW, screenH / spanH);
  return clamp(Math.min(massScale, fitScale), c.minZoom, c.maxZoom);
}

function computeTargetZoom(playerState, screen, cfg) {
  const c = cfg || ZOOM_CONFIG;
  const cells = (playerState && playerState.cells) || [];
  const mass = effectiveMassFromCells(cells, playerState && playerState.massTotal);
  let scale = massBasedScale(mass, c);
  const w = (screen && screen.width) || 1920;
  const h = (screen && screen.height) || 1080;
  scale = applyClusterFit(cells, w, h, scale, c);
  return scale;
}

function smoothZoom(current, target, cfg) {
  const c = cfg || ZOOM_CONFIG;
  return current + (target - current) * c.zoomSmoothing;
}

module.exports = {
  ZOOM_CONFIG,
  massBasedScale,
  effectiveMassFromCells,
  applyClusterFit,
  computeTargetZoom,
  smoothZoom,
  clamp,
};
