'use strict';

/**
 * Controles do cliente — troque as teclas aqui sem caçar magic numbers.
 * key: código KeyboardEvent.key (moderno) OU which/keyCode legado.
 */
module.exports = {
  // Soltar massa (W)
  fireFoodKey: 'w',
  fireFoodKeyCode: 119,

  // Split (Espaço)
  splitKey: ' ',
  splitKeyCode: 32,

  // Fusão forçada de todas as células (Backspace)
  forceMergeKey: 'Backspace',
  forceMergeKeyCode: 8,

  // Chat focus (Enter)
  chatKeyCode: 13,
};
