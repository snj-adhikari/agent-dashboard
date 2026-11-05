const CAP = 1500

const UNAMBIGUOUS = new Set([
  'cha', 'chaina', 'chu', 'garnu', 'garna', 'garera', 'garnus', 'garyo', 'gareko', 'huncha', 'hudaina', 'hunu',
  'bhayo', 'bhaneko', 'bhane', 'bhanera', 'tapai', 'timi', 'mero', 'tero', 'hamro', 'kina',
  'kaha', 'kahile', 'ahile', 'pachi', 'bholi', 'dherai', 'ramro', 'sabai', 'ani', 'herna',
  'rakha', 'rakhnu', 'dekhaucha', 'milcha', 'milena', 'bujhe', 'thikai', 'dhanyabad', 'namaste',
])
const AMBIGUOUS = new Set(['ho', 'hoina', 'ma', 'ra', 'ni', 'la', 'yo', 'lai', 'le', 'ko', 'bata', 'nai', 'pani', 'ta', 'po', 'ki', 'ka', 'sanga', 'tara', 'hera', 'kati', 'aja', 'kasari'])

const norm = (s: string) => s.toLowerCase().replace(/x/g, 'ch').replace(/v/g, 'bh').replace(/chh/g, 'ch')

export function stripNonProse(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*(at\s|File ")/.test(l) && !/^\s*[A-Za-z.]*(Error|Exception)\b.*:/.test(l))
    .join('\n')
    .replace(/\S*\/\S*/g, ' ')
    .replace(/\S*[_.0-9]\S*[A-Za-z]\S*|\b[a-z]+[A-Z]\w*|\b[A-Z]{2,}\b/g, ' ')
}

export function detectNepali(text: string, phrases: readonly string[] = []): 'devanagari' | 'roman' | null {
  const prose = stripNonProse(text)
  if (/[ऀ-ॿ]/.test(prose)) return 'devanagari'
  const padded = ` ${norm(prose).replace(/[^a-z]+/g, ' ')} `
  const hits = new Set<string>()
  let unambiguous = false
  for (const w of padded.split(' ')) {
    if (UNAMBIGUOUS.has(w)) {
      hits.add(w)
      unambiguous = true
    } else if (AMBIGUOUS.has(w)) hits.add(w)
  }
  for (const p of phrases) {
    const q = norm(p).replace(/[^a-z]+/g, ' ').trim()
    if (q.length >= 3 && padded.includes(` ${q} `)) {
      hits.add(q)
      unambiguous = true
    }
  }
  return hits.size >= 2 && unambiguous ? 'roman' : null
}

export function translateContext(glossaryMd: string | null): string {
  const lines = [
    'The user prompt is in Nepali or Roman Nepali.',
    '- Reply in English.',
    '- Make the first line of your reply exactly `Understood as: <English>`, then act on the English meaning.',
    '- Keep identifiers, paths and code verbatim; keep technical detail in English.',
  ]
  if (glossaryMd) {
    lines.push('Glossary excerpt:', glossaryMd.slice(0, CAP).trim())
    lines.push("Spelling style: follow the user's Roman Nepali spellings as shown in the glossary.")
  }
  return lines.join('\n')
}
