'use strict';

/**
 * Regra REAL de "comer" jogador×jogador neste clone
 * (owenashurst/agar.io-clone):
 *
 * Arquivo: game/src/server/map/player.js — Cell.checkWhoAteWho (≈ linhas 74–81)
 *
 *   A come B  ⇔  o círculo de B está TOTALMENTE dentro do círculo de A
 *                (SAT.js: response.bInA === true)
 *
 * NÃO existe razão de massa tipo 1.25 do agar.io clássico para PvP.
 * Com centros quase coincidentes, isso equivale a radius(A) > radius(B),
 * e como radius = 4 + sqrt(mass)*6 (util.massToRadius), basta mass(A) > mass(B).
 *
 * Observação: para comida ejetada (W / massFood) o servidor USA
 * `cell.mass > mass.mass * 1.1` em server.js canEatMass — isso NÃO se aplica
 * a células de jogador.
 *
 * Por isso SERVER_EAT_MASS_RATIO_EQUIV = 1.0 (piso teórico) e a folga real
 * vem de SACRIFICE_SAFETY_MARGIN (ex.: 1.5 ⇒ alvo precisa ter ≥ 1.5× a massa do bot).
 */

const SERVER_EAT_MASS_RATIO_EQUIV = 1.0;

/** Mesma fórmula do servidor: game/src/server/lib/util.js → massToRadius */
function massToRadius(mass) {
  return 4 + Math.sqrt(mass) * 6;
}

/**
 * Massa mínima que o ALVO precisa ter para comer o bot com a margem pedida.
 * meuMass >= botMass * SERVER_EAT_MASS_RATIO_EQUIV * safetyMargin
 */
function requiredTargetMass(botMass, safetyMargin) {
  return botMass * SERVER_EAT_MASS_RATIO_EQUIV * safetyMargin;
}

/**
 * Checagem de segurança do modo sacrifício.
 * Retorna { ok, reason, audit } — audit sempre preenchido pra log.
 */
function evaluateSacrificeSafety({
  targetMass,
  botMass,
  safetyMargin,
  minBotMass,
  feedingMode,
}) {
  const required = requiredTargetMass(botMass, safetyMargin);
  const ratio = botMass > 0 ? targetMass / botMass : Infinity;
  const audit = {
    targetMass: round1(targetMass),
    botMass: round1(botMass),
    serverEatRatioEquiv: SERVER_EAT_MASS_RATIO_EQUIV,
    safetyMargin,
    requiredTargetMass: round1(required),
    actualRatio: round1(ratio),
    // Lado certo da conta: target deve ser o MAIOR (quem come), bot o menor (comida)
    formula: 'targetMass >= botMass * 1.0 * SAFETY_MARGIN',
    wouldTargetEatBot: targetMass >= required,
    wouldBotEatTarget: botMass >= requiredTargetMass(targetMass, safetyMargin),
  };

  if (feedingMode === 'trickle') {
    return { ok: false, reason: 'mode_trickle', audit };
  }
  if (!(botMass >= minBotMass)) {
    return { ok: false, reason: 'bot_too_small', audit };
  }
  if (!(targetMass >= required)) {
    return { ok: false, reason: 'target_too_small', audit };
  }
  // Cinto e suspensório: nunca sacrificar se, invertendo a conta, o bot
  // passaria na checagem "com margem" contra o alvo.
  if (botMass >= requiredTargetMass(targetMass, 1.0)) {
    return { ok: false, reason: 'bot_not_strictly_smaller', audit };
  }

  return { ok: true, reason: 'safe', audit };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

module.exports = {
  SERVER_EAT_MASS_RATIO_EQUIV,
  massToRadius,
  requiredTargetMass,
  evaluateSacrificeSafety,
};
