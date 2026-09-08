#!/usr/bin/env node
/**
 * simulate_fedapay_webhook.js
 * Usage:
 *  node simulate_fedapay_webhook.js --url http://localhost:8000/webhook/paiement --secret "wh_sandbox_..." --transactionId tx_123 --eventName transaction.approved --amount 1000
 *  node simulate_fedapay_webhook.js --url http://localhost:8000/webhook/paiement --unsigned --transactionId tx_123
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

function parseArgs() {
  const args = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = raw[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

const opts = parseArgs();
const targetUrl = opts.url || process.env.TARGET_URL || 'http://localhost:8000/webhook/paiement';
const secret = opts.secret || process.env.FEDAPAY_WEBHOOK_SECRET || '';
const unsigned = opts.unsigned || opts.u || false;
const transactionId = opts.transactionId || opts.tx || `tx_${Math.random().toString(36).slice(2,9)}`;
const eventName = opts.eventName || 'transaction.approved';
const amount = Number(opts.amount || 1000);

const event = {
  id: `evt_${Math.random().toString(36).slice(2,9)}`,
  name: eventName,
  entity: {
    id: String(transactionId),
    status: eventName.includes('approved') ? 'approved' : (eventName.includes('canceled') ? 'canceled' : 'pending'),
    amount,
    currency: { iso: 'XOF' },
  },
};

const payloadString = JSON.stringify(event);

let signatureHeader = '';
if (!unsigned && secret) {
  // simple HMAC-SHA256 signature (hex) — matches common webhook schemes
  signatureHeader = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

const urlObj = new URL(targetUrl);
const lib = urlObj.protocol === 'https:' ? https : http;

const requestOptions = {
  hostname: urlObj.hostname,
  port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
  path: urlObj.pathname + (urlObj.search || ''),
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payloadString),
  },
};

if (!unsigned && signatureHeader) {
  requestOptions.headers['x-fedapay-signature'] = signatureHeader;
}

console.log('Sending webhook to', targetUrl);
console.log('Unsigned:', !!unsigned, 'transactionId:', transactionId);
if (!unsigned) console.log('Using signature:', signatureHeader.slice(0, 16) + '...');
console.log('Payload:', payloadString);

const req = lib.request(requestOptions, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response status:', res.statusCode);
    try {
      console.log('Response body:', JSON.parse(data));
    } catch (e) {
      console.log('Response body (raw):', data);
    }
  });
});

req.on('error', (err) => {
  console.error('Request error:', err.message);
});

req.write(payloadString);
req.end();
