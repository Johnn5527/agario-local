'use strict';

function timestamp() {
  return new Date().toISOString().split('T')[1].replace('Z', '');
}

function makeLogger(label) {
  const prefix = `[${label}]`;
  return {
    info: (...args) => console.log(timestamp(), prefix, ...args),
    warn: (...args) => console.warn(timestamp(), prefix, '⚠', ...args),
    error: (...args) => console.error(timestamp(), prefix, '✖', ...args),
  };
}

module.exports = { makeLogger };
