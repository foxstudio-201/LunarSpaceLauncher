const { parentPort, workerData } = require('worker_threads')
const crypto = require('crypto')
const fs = require('fs')

const sha1File = (file) =>
  new Promise((resolve) => {
    const hash = crypto.createHash('sha1')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', () => resolve(''))
  })

const main = async () => {
  const files = workerData?.files || []
  const out = []
  for (const file of files) out.push([file, await sha1File(file)])
  parentPort.postMessage(out)
}

main().catch(() => parentPort.postMessage([]))
