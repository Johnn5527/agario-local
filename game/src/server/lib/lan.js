'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Retorna IPv4(s) da LAN (ignora loopback e interfaces internas).
 */
function getLanIPv4Addresses() {
  const nets = os.networkInterfaces();
  const results = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = net.family === 'IPv4' || net.family === 4;
      if (!family || net.internal) continue;
      results.push({ name, address: net.address });
    }
  }

  return results;
}

function pickPrimaryLanIP() {
  const list = getLanIPv4Addresses();
  if (!list.length) return null;
  // Preferir 192.168.x / 10.x típicos de Wi-Fi doméstico
  const preferred = list.find((x) =>
    x.address.startsWith('192.168.') ||
    x.address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(x.address)
  );
  return (preferred || list[0]).address;
}

/**
 * Imprime URL + QR no console e grava lan-qr.png na pasta do jogo.
 */
async function printLanInvite(port) {
  const ip = pickPrimaryLanIP();
  if (!ip) {
    console.log('[LAN] Nenhum IP de rede local encontrado. Conecte-se ao Wi-Fi e reinicie o servidor.');
    return null;
  }

  const url = `http://${ip}:${port}`;
  console.log('');
  console.log('========================================');
  console.log('  JOGAR NA REDE LOCAL (LAN / Wi-Fi)');
  console.log('========================================');
  console.log(`  URL: ${url}`);
  console.log('  No celular/PC da mesma Wi-Fi, abra o link');
  console.log('  ou escaneie o QR code abaixo.');
  console.log('========================================');
  console.log('');

  try {
    const QRCode = require('qrcode');
    const ascii = await QRCode.toString(url, { type: 'terminal', small: true });
    console.log(ascii);

    const outPng = path.join(__dirname, '..', '..', '..', 'lan-qr.png');
    await QRCode.toFile(outPng, url, { width: 480, margin: 2 });
    console.log(`[LAN] QR salvo em: ${outPng}`);
  } catch (err) {
    console.log('[LAN] Não foi possível gerar QR (instale: npm install qrcode). URL acima ainda funciona.');
    console.log('[LAN]', err.message);
  }

  console.log('');
  console.log('Dica Windows — descobrir IP de novo:');
  console.log('  ipconfig');
  console.log('Dica Linux/Mac:');
  console.log('  ip addr   OU   ifconfig');
  console.log('');

  return { ip, url };
}

module.exports = {
  getLanIPv4Addresses,
  pickPrimaryLanIP,
  printLanInvite,
};
