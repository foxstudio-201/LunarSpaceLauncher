const { parentPort, workerData } = require('worker_threads')
const { renderRegion } = require('./worldmap.cjs')
const { SurfacePalette } = require('./mapsurface.cjs')

let palette = null

const init = async () => {
  if (!workerData?.surface) return
  palette = new SurfacePalette({
    jars: workerData.surface.jars || [],
    cacheDir: workerData.surface.cacheDir || '',
    version: workerData.surface.version || '',
  })
  await palette.load()
  await palette.loadIndex().catch(() => {})
}

parentPort.on('message', async (job) => {
  if (job?.prime) {
    if (palette) {
      await palette.loadIndex().catch(() => {})
      await palette.saveIndex().catch(() => {})
    }
    parentPort.postMessage({ primed: true })
    return
  }
  if (job?.quit) {
    if (palette) await palette.save().catch(() => {})
    parentPort.postMessage({ done: true })
    return
  }
  try {
    const result = renderRegion({ ...job, palette })
    parentPort.postMessage(
      {
        id: job.id,
        rgb: result.rgb.buffer,
        heights: result.heights.buffer,
        chunks: result.chunks,
        slot: result.slot,
      },
      [result.rgb.buffer, result.heights.buffer],
    )
  } catch {
    parentPort.postMessage({ id: job.id, failed: true })
  }
})

init()
  .then(() => parentPort.postMessage({ ready: true }))
  .catch(() => parentPort.postMessage({ ready: true }))
