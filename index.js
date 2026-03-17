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

// API for Pairing
app.get('/pair', async (req, res) => {
  let phone = req.query.phone
  if (!phone) return res.json({ error: 'Provide Phone Number' })
  try {
    const code = await startSession(phone, 'pair')
    res.json({ code })
  } catch (err) {
    console.error("Pairing Error:", err)
    res.status(500).json({ error: 'Pairing Failed' })
  }
})

// API for QR
app.get('/getqr', async (req, res) => {
  try {
    const qrData = await startSession(null, 'qr')
    res.json({ qr: qrData })
  } catch (err) {
    console.error("QR Error:", err)
    res.status(500).json({ error: 'QR Failed' })
  }
})

// --- CORE LOGIC ---
async function startSession(phone, method) {
  const sessionFolder = `./auth/${Math.random().toString(36).substring(7)}`
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder)
  const { version } = await fetchLatestBaileysVersion()

  return new Promise(async (resolve, reject) => {
    // FIX: Handling the Baileys import correctly for ESM
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

      // Handle QR Method
      if (method === 'qr' && qr) {
        try {
          const qrImage = await QRCode.toDataURL(qr)
          resolve(qrImage)
        } catch (e) { reject(e) }
      }

      // Handle Pairing Method
      if (method === 'pair' && !sock.authState.creds.registered) {
        await delay(3000) 
        try {
          const code = await sock.requestPairingCode(phone.replace(/[^0-9]/g, ''))
          resolve(code)
        } catch (e) {
          reject(e)
        }
      }

      if (connection === 'open') {
        await delay(5000)
        try {
          const rawCreds = fs.readFileSync(`${sessionFolder}/creds.json`, 'utf-8')
          const output = await pastebin.createPaste(rawCreds, 'JOEL-XMD-SESSION')
          const sessi = 'JOEL~XMD~' + output.split('https://pastebin.com/')[1]
          
          await sock.sendMessage(sock.user.id, { text: sessi })
          
          setTimeout(() => {
              if (fs.existsSync(sessionFolder)) {
                fs.rmSync(sessionFolder, { recursive: true, force: true })
              }
              process.send('reset')
          }, 3000)
        } catch (e) {
          console.error("Connection Open Error:", e)
        }
      }

      if (connection === 'close') {
        let reason = new Boom(lastDisconnect?.error)?.output.statusCode
        if (reason !== DisconnectReason.loggedOut) {
          // If using cluster/joel.js, this will trigger a restart
          if (process.send) process.send('reset')
        }
      }
    })
  })
}

app.listen(PORT, () => console.log(`JOEL-XMD Online: ${PORT}`))
