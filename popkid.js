import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import cluster from 'cluster'
import cfonts from 'cfonts'
import { createInterface } from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { say } = cfonts

say('JOEL-XMD', {
  font: 'pallet',
  align: 'center',
  gradient: ['red', 'magenta'],
})

var isRunning = false

function start(file) {
  if (isRunning) return
  isRunning = true
  let args = [join(__dirname, file), ...process.argv.slice(2)]
  
  // Use setupPrimary for modern Node.js
  cluster.setupPrimary({
    exec: args[0],
    args: args.slice(1),
  })
  
  let p = cluster.fork()

  p.on('message', data => {
    if (data === 'reset') {
      p.kill()
      isRunning = false
      start(file)
    }
  })
  
  p.on('exit', (_, code) => {
    isRunning = false
    console.error('❎ Child process exited with code:', code)
    if (code !== 0) start(file)
  })
}

start('index.js')
