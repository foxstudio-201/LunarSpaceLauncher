const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'dist-electron')
const version = require('../package.json').version
const name = `LunarSpace-Launcher-Setup-${version}.exe`
const file = path.join(dir, name)

if (!fs.existsSync(file)) {
  console.error(`[feed] missing ${file}`)
  process.exit(1)
}

const data = fs.readFileSync(file)
const sha512 = crypto.createHash('sha512').update(data).digest('base64')

const feed = [
  `version: ${version}`,
  'files:',
  `  - url: ${name}`,
  `    sha512: ${sha512}`,
  `    size: ${data.length}`,
  `path: ${name}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n')

fs.writeFileSync(path.join(dir, 'latest.yml'), feed, 'utf8')
console.log(`[feed] latest.yml -> ${name} (${data.length} bytes)`)
