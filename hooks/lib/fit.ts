// Sizing the game picture to the pane (the same rule the runner uses).
//
// A half-block cell holds two square pixels stacked, so a Raster `columns`
// wide and `rows` tall shows a picture `columns` x `2 * rows` pixels.

export function fitRaster(maxColumns: number, maxRows: number, aspect: number) {
  const columns = Math.max(1, Math.min(512, Math.floor(maxColumns), Math.floor(2 * maxRows * aspect)))
  const rows = Math.max(1, Math.min(256, Math.round(columns / aspect / 2)))
  return { columns, rows }
}

/** An Image box of whole cells, assuming cells about twice as tall as wide. */
export function fitImage(maxColumns: number, maxRows: number, aspect: number) {
  const columns = Math.max(1, Math.min(255, Math.floor(maxColumns), Math.floor(2 * maxRows * aspect)))
  const rows = Math.max(1, Math.min(255, Math.round(columns / aspect / 2)))
  return { columns, rows }
}

/** A text progress bar: `██████░░░░ 60%`. */
export function progressBar(fraction: number, width = 20) {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(fraction * 100)}%`
}
