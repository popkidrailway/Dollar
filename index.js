import { Boom } from '@hapi/boom'
import Baileys, {
  DisconnectReason,
  delay,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import PastebinAPI from 'pastebin-js'
import path, { dirname } from 'path'
import pino from 'pino'
import { fileURLToPath } from 'url'

let pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL')
const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.use(cors())
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  next()
})

let PORT = process.env.PORT || 8000

function createRandomId() {
  return Math.random().toString(36).substring(2, 12)
}

async function startnigg(phone) {
  let sessionFolder = `./auth/${createRandomId()}`
  
  return new Promise(async (resolve, reject) => {
    try {
      if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true })
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionFolder)

      const negga = Baileys.default({
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // Critical: 'Chrome' + 'Mobile' is usually required for pairing codes now
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
      })

      if (!negga.authState.creds.registered) {
        let phoneNumber = phone ? phone.replace(/[^0-9]/g, '') : ''
        if (phoneNumber.length < 10) {
          return reject(new Error('Invalid Phone Number!'))
        }

        setTimeout(async () => {
          try {
            let code = await negga.requestPairingCode(phoneNumber)
            console.log(`Pairing Code for ${phoneNumber}: ${code}`)
            resolve(code)
          } catch (err) {
            reject(new Error('Error requesting pairing code'))
          }
        }, 3000)
      }

      negga.ev.on('creds.update', saveCreds)

      negga.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
          await delay(5000)
          try {
            const rawCreds = fs.readFileSync(`${sessionFolder}/creds.json`, 'utf-8')
            const output = await pastebin.createPaste(rawCreds, 'JOEL-XMD-SESSION')
            const sessi = 'JOEL~XMD~' + output.split('https://pastebin.com/')[1]
            
            await negga.sendMessage(negga.user.id, { 
                text: sessi 
            })
            
            await negga.sendMessage(negga.user.id, {
              text: `*╭──────────────━┈⊷*\n*║ ᴊᴏᴇʟ-xᴍᴅ sᴇssɪᴏɴ ɪᴅ*\n*╰───────────────━⊷*\n\n*sᴇssɪᴏɴ ᴄᴏɴɴᴇᴄᴛᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ!*\n\n*ᴏᴡɴᴇʀ:* Popkid\n*ᴛʜᴀɴᴋs ғᴏʀ ᴄʜᴏᴏsɪɴɢ ᴊᴏᴇʟ-ᴍᴅ*`
            })

            console.log('Session Uploaded:', sessi)
            
            // Wait before cleanup
            await delay(2000)
            fs.rmSync(sessionFolder, { recursive: true, force: true })
            process.send('reset')
          } catch (e) {
            console.error('Upload Error:', e)
          }
        }

        if (connection === 'close') {
          let reason = new Boom(lastDisconnect?.error)?.output.statusCode
          console.log(`Connection closed: ${reason}`)
          if (reason !== DisconnectReason.loggedOut) {
             process.send('reset')
          }
        }
      })

    } catch (error) {
      reject(error)
    }
  })
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')))
app.get('/pair', async (req, res) => {
  let phone = req.query.phone
  if (!phone) return res.json({ error: 'Please Provide Phone Number' })
  try {
    const code = await startnigg(phone)
    res.json({ code })
  } catch (error) {
    res.status(500).json({ error: 'Pairing Failed' })
  }
})

app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
