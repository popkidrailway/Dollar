import { Boom } from '@hapi/boom'
import makeWASocket, {
  DisconnectReason,
  delay,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import PastebinAPI from 'pastebin-js'
import path, { dirname } from 'path'
import pino from 'pino'
import { fileURLToPath } from 'url'
import QRCode from 'qrcode'

let pastebin = new PastebinAPI('WgRGngwD6YAaVHaoXpvWN1nnUYMXBA3S')
const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.use(cors())
app.use(express.static(__dirname))

let PORT = process.env.PORT || 8000

// --- ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')))
app.get('/code', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')))
app.get('/qr', (req, res) => res.sendFile(path.join(__dirname, 'qr.html')))

app.get('/pair', async (req, res) => {
  let phone = req.query.phone
  if (!phone) return res.json({ error: 'Provide Phone Number' })
  try {
    const code = await startSession(phone, 'pair')
    res.json({ code })
  } catch (err) {
    res.status(500).json({ error: 'Pairing Failed' })
  }
})

app.get('/getqr', async (req, res) => {
  try {
    const qrData = await startSession(null, 'qr')
    res.json({ qr: qrData })
  } catch (err) {
    res.status(500).json({ error: 'QR Failed' })
  }
})

// --- CORE LOGIC ---
async function startSession(phone, method) {
  // Use a unique ID for each attempt to avoid cache conflicts
  const id = Math.random().toString(36).substring(7);
  const sessionFolder = path.join(__dirname, 'auth', id);
  
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder)
  const { version } = await fetchLatestBaileysVersion()

  return new Promise(async (resolve, reject) => {
    const socketFunction = makeWASocket.default || makeWASocket;
    
    const sock = socketFunction({
      version,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      // Handle QR
      if (method === 'qr' && qr) {
        try {
          const qrImage = await QRCode.toDataURL(qr)
          resolve(qrImage)
        } catch (e) { reject(e) }
      }

      // Handle Pairing Code
      if (method === 'pair' && !sock.authState.creds.registered) {
        // Reduced delay to prevent timeout before user enters code
        await delay(1500) 
        try {
          const code = await sock.requestPairingCode(phone.replace(/[^0-9]/g, ''))
          resolve(code)
        } catch (e) { reject(e) }
      }

      if (connection === 'open') {
        // Essential: Wait for the session to fully "settle" on WA servers
        await delay(10000)
        try {
          const credsPath = path.join(sessionFolder, 'creds.json');
          const rawCreds = fs.readFileSync(credsPath, 'utf-8')
          const output = await pastebin.createPaste(rawCreds, 'JOEL-XMD-SESSION')
          const sessi = 'JOEL~XMD~' + output.split('https://pastebin.com/')[1]
          
          await sock.sendMessage(sock.user.id, { text: sessi })
          
          // Cleanup after success
          setTimeout(() => {
              try {
                fs.rmSync(sessionFolder, { recursive: true, force: true })
              } catch (e) {}
              if (process.send) process.send('reset')
          }, 5000)
        } catch (e) {
          console.error("Success handling error:", e)
        }
      }

      if (connection === 'close') {
        let reason = new Boom(lastDisconnect?.error)?.output.statusCode
        // ONLY reset if it's not a temporary disconnect during pairing
        if (reason !== DisconnectReason.loggedOut && connection !== 'connecting') {
          if (process.send) process.send('reset')
        }
      }
    })
  })
}

app.listen(PORT, () => console.log(`JOEL-XMD Online: ${PORT}`))
