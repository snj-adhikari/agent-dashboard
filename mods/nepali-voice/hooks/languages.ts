import type { Engine } from 'claude-code'

export const NE_ROMAN = {
  id: 'ne-roman',
  label: 'Roman Nepali',
  detect: {
    scripts: [['0900', '097F']],
    sure: ['chha', 'chhu', 'chhau', 'chhan', 'garchu', 'garchau', 'garne', 'garnu', 'garera', 'gara', 'bhayo', 'bhane', 'bhanera', 'hoina', 'chaina', 'tapai', 'timi', 'hajur', 'dhanyabad', 'ramro', 'kasto', 'kina', 'kaha', 'yaha', 'tyaha', 'huncha', 'parcha', 'lagyo', 'ahile', 'bholi', 'pani', 'matlab'],
    maybe: ['ma', 'ho', 'ko', 'ra', 'ta', 'ke', 'ni', 'ki', 'ek'],
    minHits: 2,
    normalise: [['x', 'ch'], ['v', 'bh']],
  },
  learnt: 'raw/{date}-nepali-learnt.jsonl',
}

export async function writeDetector($: Engine, folder: string): Promise<void> {
  const path = `${folder}/languages/ne-roman.json`
  if (await $.fs.exists(path)) return
  await $.process.run(['mkdir', '-p', `${folder}/languages`]).catch(() => {})
  await $.fs.write(path, JSON.stringify(NE_ROMAN, null, 2)).catch(() => {})
}
