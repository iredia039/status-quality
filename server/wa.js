const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { MongoClient } = require('mongodb');
const { useMongoAuthState } = require('./mongo-auth');

const AUTH_DIR = path.join(__dirname, 'wa-auth');

let sock = null;
let ready = false;
let mongoClient = null;

async function getAuthState(baileys) {
  if (!process.env.MONGODB_URI) {
    return baileys.useMultiFileAuthState(AUTH_DIR);
  }
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
  }
  const collection = mongoClient.db('status_quality').collection('wa_auth');
  return useMongoAuthState(collection, baileys);
}

async function startWhatsApp() {
  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket =
    typeof baileys.default === 'function'
      ? baileys.default
      : baileys.default?.default || baileys.makeWASocket;
  const { DisconnectReason, fetchLatestBaileysVersion } = baileys;

  const { state, saveCreds } = await getAuthState(baileys);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }) });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === 'open') {
      ready = true;
      console.log('WhatsApp connected');
    }
    if (connection === 'close') {
      ready = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('WhatsApp logged out. Clear the saved login and restart to scan again.');
      } else {
        console.log('WhatsApp disconnected, reconnecting...');
        startWhatsApp().catch((err) => console.error('Reconnect failed:', err.message));
      }
    }
  });
}

// Returns the WhatsApp JID if the number is on WhatsApp, otherwise null
async function resolveNumber(number) {
  if (!ready) throw new Error('WhatsApp is not connected');
  const [result] = await sock.onWhatsApp(number);
  return result?.exists ? result.jid : null;
}

async function sendVideoAsDocument(jid, filePath) {
  if (!ready) throw new Error('WhatsApp is not connected');
  await sock.sendMessage(jid, {
    video: { url: filePath },
    mimetype: 'video/mp4',
    caption: 'Your video is ready.'
  });
}

function getSenderNumber() {
  const id = sock?.user?.id || '';
  return id.split(':')[0].split('@')[0] || null;
}

module.exports = { startWhatsApp, resolveNumber, sendVideoAsDocument, getSenderNumber };