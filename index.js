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

// Your Pastebin Key
let pastebin = new PastebinAPI('WgRGngwD6YAaVHaoXpvWN1nnUYMXBA3S')

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.use(cors())
app.use(express.static(__dirname))

let PORT = process.env.PORT || 8000

// --- HTML ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')))
app.get('/code', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')))
app.get('/qr', (req, res) => res.sendFile(path.join(__dirname, 'qr.html')))

// --- API ENDPOINTS ---

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
  // Create a clean, unique folder for every attempt
  const id = Math.random().toString(36).substring(7)
  const sessionFolder = path.join(__dirname, 'auth', id)
  
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true })
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder)
  const { version } = await fetchLatestBaileysVersion()

  return new Promise(async (resolve, reject) => {
    // FIX: Handling the Baileys import correctly for all versions
    const socketFunction = makeWASocket.default || makeWASocket;
    
    const sock = socketFunction({
      version,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      // Updated Browser ID for better stability
      browser: ["Chrome (Linux)", "", ""], 
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      // 1. Handle QR Method
      if (method === 'qr' && qr) {
        try {
          const qrImage = await QRCode.toDataURL(qr)
          resolve(qrImage)
        } catch (e) { reject(e) }
      }

      // 2. Handle Pairing Method (With Stabilization)
      if (method === 'pair' && !sock.authState.creds.registered) {
        // Critical: Wait 8 seconds for the socket to stabilize keys
        console.log("Stabilizing for pairing...")
        await delay(8000) 
        try {
          const cleanedNumber = phone.replace(/[^0-9]/g, '')
          const code = await sock.requestPairingCode(cleanedNumber)
          resolve(code)
        } catch (e) {
          reject(e)
        }
      }

      // 3. Handle Successful Connection
      if (connection === 'open') {
        console.log("Connected! Stabilizing session...")
        await delay(10000) // Wait for WA to sync before grabbing creds

        try {
          const credsPath = path.join(sessionFolder, 'creds.json')
          const rawCreds = fs.readFileSync(credsPath, 'utf-8')
          const output = await pastebin.createPaste(rawCreds, 'JOEL-XMD-SESSION')
          const sessi = 'JOEL~XMD~' + output.split('https://pastebin.com/')[1]
          
          await sock.sendMessage(sock.user.id, { text: sessi })
          
          await sock.sendMessage(sock.user.id, {
            text: `*╭──────────────━┈⊷*\n*║ ᴊᴏᴇʟ-xᴍᴅ sᴇssɪᴏɴ ɪᴅ*\n*╰───────────────━⊷*\n\n*sᴇssɪᴏɴ ᴄᴏɴɴᴇᴄᴛᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ!*\n\n*ᴛʜᴀɴᴋs ғᴏʀ ᴄʜᴏᴏsɪɴɢ ᴊᴏᴇʟ-ᴍᴅ*`
          })

          // Final cleanup and restart
          setTimeout(() => {
              if (fs.existsSync(sessionFolder)) {
                fs.rmSync(sessionFolder, { recursive: true, force: true })
              }
              if (process.send) process.send('reset')
          }, 5000)

        } catch (e) {
          console.error("Session Upload Failed:", e)
        }
      }

      // 4. Handle Disconnection
      if (connection === 'close') {
        let reason = new Boom(lastDisconnect?.error)?.output.statusCode
        if (reason !== DisconnectReason.loggedOut && connection !== 'connecting') {
          if (process.send) process.send('reset')
        }
      }
    })
  })
}

app.listen(PORT, () => console.log(`JOEL-XMD API Running on PORT: ${PORT}`))
