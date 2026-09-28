'use strict';

/**
 * Testes unitários da lógica de sacrifício (sem servidor).
 * Rode: node test/sacrifice_logic.test.js
 */

const assert = require('assert');
const {
  SERVER_EAT_MASS_RATIO_EQUIV,
  requiredTargetMass,
  evaluateSacrificeSafety,
} = require('../lib/sacrifice');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('✓', name);
  } catch (err) {
    console.error('✖', name);
    console.error(' ', err.message);
    process.exitCode = 1;
  }
}

test('razão PvP do clone é 1.0 (contenção), não 1.25', () => {
  assert.strictEqual(SERVER_EAT_MASS_RATIO_EQUIV, 1.0);
});

test('massa exigida = bot * 1.0 * margem', () => {
  assert.strictEqual(requiredTargetMass(40, 1.5), 60);
  assert.strictEqual(requiredTargetMass(100, 1.5), 150);
});

test('BLOQUEIA se alvo não tem folga (evita bot encostar sem ser comido)', () => {
  const r = evaluateSacrificeSafety({
    targetMass: 50,
    botMass: 40,
    safetyMargin: 1.5,
    minBotMass: 40,
    feedingMode: 'hybrid',
  });
  // precisa 60; tem 50 → não
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'target_too_small');
  assert.strictEqual(r.audit.wouldTargetEatBot, false);
});

test('PERMITE sacrifício quando alvo >= bot * margem', () => {
  const r = evaluateSacrificeSafety({
    targetMass: 90,
    botMass: 40,
    safetyMargin: 1.5,
    minBotMass: 40,
    feedingMode: 'hybrid',
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.audit.wouldTargetEatBot);
  assert.strictEqual(r.audit.wouldBotEatTarget, false);
});

test('BLOQUEIA se bot ainda é pequeno demais', () => {
  const r = evaluateSacrificeSafety({
    targetMass: 200,
    botMass: 25,
    safetyMargin: 1.5,
    minBotMass: 40,
    feedingMode: 'hybrid',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bot_too_small');
});

test('modo trickle nunca sacrifica', () => {
  const r = evaluateSacrificeSafety({
    targetMass: 500,
    botMass: 100,
    safetyMargin: 1.5,
    minBotMass: 40,
    feedingMode: 'trickle',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'mode_trickle');
});

test('NUNCA permite se bot >= alvo (conta invertida = perigo de comer o jogador)', () => {
  const r = evaluateSacrificeSafety({
    targetMass: 40,
    botMass: 80,
    safetyMargin: 1.5,
    minBotMass: 40,
    feedingMode: 'sacrifice',
  });
  assert.strictEqual(r.ok, false);
  // target_too_small ou bot_not_strictly_smaller
  assert.ok(['target_too_small', 'bot_not_strictly_smaller'].includes(r.reason));
  assert.strictEqual(r.audit.wouldBotEatTarget, true);
});

test('ABORT path: se massa do alvo cair, a checagem passa a falhar (bot deve sair de SACRIFICING)', () => {
  const before = evaluateSacrificeSafety({
    targetMass: 100,
    botMass: 40,
    safetyMargin: 1.5,
    minBotMass: 40,
    feedingMode: 'hybrid',
  });
  assert.strictEqual(before.ok, true);

  const after = evaluateSacrificeSafety({
    targetMass: 50,
    botMass: 40,
    safetyMargin: 1.5,
    minBotMass: 40,
    feedingMode: 'hybrid',
  });
  assert.strictEqual(after.ok, false);
  assert.strictEqual(after.reason, 'target_too_small');
});

test('audit sempre traz os dois lados da conta', () => {
  const r = evaluateSacrificeSafety({
    targetMass: 100,
    botMass: 40,
    safetyMargin: 1.5,
    minBotMass: 40,
    feedingMode: 'hybrid',
  });
  assert.strictEqual(r.audit.targetMass, 100);
  assert.strictEqual(r.audit.botMass, 40);
  assert.ok(r.audit.formula.includes('targetMass >='));
  assert.strictEqual(typeof r.audit.wouldTargetEatBot, 'boolean');
  assert.strictEqual(typeof r.audit.wouldBotEatTarget, 'boolean');
});

console.log(`\n${passed} testes OK`);
if (process.exitCode) {
  console.error('Falhas encontradas.');
} else {
  console.log('Regra documentada: PvP = contenção (bInA), razão equiv=1.0, margem=SACRIFICE_SAFETY_MARGIN');
}
