/** Pure rules shared with agent-monitor's src/shared/injection.ts; keep the two files identical. */
export type Rule = [RegExp, number, string]

export const INJECTION: Rule[] = [
  [/\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|your)\b.{0,20}\b(instructions?|prompts?|rules?|context)\b/i, 5, 'override instructions'],
  [/\b(new|updated|real|actual) (system )?instructions?\b|\bsystem prompt\b|\byou are now\b|\bfrom now on,? you\b/i, 4, 'role/system rewrite'],
  [/<\/?(system|assistant|user|instructions?)>|\[\/?INST\]|^#{2,}\s*(system|instruction)/im, 4, 'fake prompt markup'],
  [/\b(claude|assistant|ai agent|llm|copilot|the agent|ai)\b[,:]?\s.{0,40}\b(run|execute|delete|remove|push|merge|approve|send|post|curl|install|commit|reset|drop)\b/i, 4, 'instruction addressed to the agent'],
  [/\b(do not|don't|never) (tell|inform|mention|ask)\b.{0,20}\b(the )?(user|human|anyone)\b|\bwithout (asking|telling|confirmation)\b|\bsilently\b|\bsecretly\b/i, 4, 'concealment from user'],
  [/\b(reveal|print|show|output|send|leak|dump)\b.{0,30}\b(system prompt|api[_ -]?keys?|tokens?|secrets?|credentials?|\.env|env vars?|passwords?)\b/i, 5, 'secret exfiltration'],
  [/\b(curl|wget)\b[^\n|]{0,200}\|\s*(ba|z)?sh\b|\brm -rf\b|\bgit push (-f|--force)\b|\bchmod \+x\b/i, 4, 'dangerous command'],
  [/[\u200B-\u200F\u2060-\u2064\uFEFF](?=[\s\S]*[\u200B-\u200F\u2060-\u2064\uFEFF])|[\u{E0000}-\u{E007F}]/u, 3, 'hidden unicode'],
  [/[\u200B-\u200F\u2060-\u2064\uFEFF](?<=^[^\u200B-\u200F\u2060-\u2064\uFEFF\u{E0000}-\u{E007F}]*[\u200B-\u200F\u2060-\u2064\uFEFF])(?=[^\u200B-\u200F\u2060-\u2064\uFEFF\u{E0000}-\u{E007F}]*$)/u, 2, 'single hidden character'],
  [/\b(execute|run) (the )?following\b|\bcopy and (run|paste)\b/i, 2, 'run-this phrasing'],
]

export const HEAVY: Rule[] = [
  [/\b(all|every|entire|whole)\b.{0,30}\b(files?|repos?|repositories|prs?|pull requests?|tickets?|codebase|history)\b/i, 3, 'sweeping scope'],
]

export const HIGH = 5
export const MED = 3
export const HEAVY_TOKENS = 3000

export const scan = (text: string, rules: Rule[]) => {
  let score = 0
  const hits: string[] = []
  for (const [re, w, label] of rules) {
    const m = re.exec(text)
    if (!m) continue
    score += w
    const at = Math.max(0, m.index - 60)
    hits.push(`${label}: "…${text.slice(at, m.index + m[0].length + 80).replace(/\s+/g, ' ').trim()}…"`)
  }
  return { score, hits }
}

export const level = (s: number) => (s >= HIGH ? 'HIGH' : s >= MED ? 'MEDIUM' : 'LOW')

export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

/** Why a text would burn a lot of tokens: its own size or sweeping phrasing. */
export const heavyReasons = (text: string) => {
  const tokens = estimateTokens(text)
  return [...(tokens > HEAVY_TOKENS ? [`~${tokens} tokens`] : []), ...scan(text, HEAVY).hits]
}
