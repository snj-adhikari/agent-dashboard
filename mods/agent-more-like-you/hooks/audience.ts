export type Audience = 'slack-dm' | 'slack-channel' | 'jira' | 'confluence' | 'github-pr'
export type Label = 'human' | 'ai' | 'mixed' | 'unsure'
export interface AgentWrite { tool: string; target: string; text: string; ts: string }

type Input = Record<string, unknown>

export interface PullRow {
  id: string
  source: string
  ts: string
  text: string
  authorId?: string
  author?: 'self' | 'other' | 'unknown'
  self?: boolean
  audience?: Audience
  target?: string
  channel?: string
  thread?: string
  issue?: string
  contentId?: string
  repo?: string
  number?: number
  path?: string
  permalink?: string
}
export interface Identity { slackId?: string; ghLogin?: string; accountId?: string }

const JIRA = 'addOrEditJiraIssueComment'
const CONFLUENCE = ['createConfluenceFooterComment', 'createConfluenceInlineComment']
const SLACK_SEND = /slack_send_message(_draft)?$/
const GH_COMMENT = /\bgh\s+pr\s+(comment|review)\b/
const GH_API = /\bgh\s+api\b/
const GH_BODY = /(?:^|\s)(?:-f|-F|--field|--raw-field)\s+body=|--body\b/
export const SECTION_TITLE:Record<Audience, string> = {
  'slack-dm': 'Slack DM',
  'slack-channel': 'Slack channel',
  jira: 'Jira',
  confluence: 'Confluence',
  'github-pr': 'GitHub PR',
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isGhWrite = (c: string) => GH_COMMENT.test(c) || (GH_API.test(c) && GH_BODY.test(c))

function resolve(tool: string, input: Input): { name: string; args: Input } {
  if (tool.endsWith('executeWrite')) {
    const args = input.inputs
    return { name: str(input.name), args: args && typeof args === 'object' ? (args as Input) : {} }
  }
  return { name: tool, args: input }
}

export function audienceOf(tool: string, input: Input): Audience | null {
  if (tool === 'Bash') return isGhWrite(str(input.command)) ? 'github-pr' : null
  if (SLACK_SEND.test(tool)) return /^[DU]/.test(str(input.channel_id)) ? 'slack-dm' : 'slack-channel'
  const { name } = resolve(tool, input)
  if (name.endsWith(JIRA)) return 'jira'
  if (CONFLUENCE.some((c) => name.endsWith(c))) return 'confluence'
  return null
}

function ghTarget(command: string): string | null {
  const url = command.match(/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)/)
  if (url) return `${url[1]}#${url[2]}`
  const api = command.match(/\brepos\/([\w.-]+\/[\w.-]+)\/(?:issues|pulls)\/(\d+)/)
  if (api) return `${api[1]}#${api[2]}`
  const repo = command.match(/(?:-R|--repo)[\s=]+([\w.-]+\/[\w.-]+)/)
  const num = command.match(/\bgh\s+pr\s+(?:comment|review)\s+(?:-\S+\s+)*(\d+)/)
  return repo && num ? `${repo[1]}#${num[1]}` : null
}

export function targetOf(tool: string, input: Input): string | null {
  const audience = audienceOf(tool, input)
  if (!audience) return null
  if (audience === 'github-pr') return ghTarget(str(input.command))
  const { args } = resolve(tool, input)
  if (audience === 'jira') return str(args.issueIdOrKey) || str(args.issueKey) || null
  if (audience === 'confluence') return str(args.pageId) || str(args.contentId) || null
  const channel = str(args.channel_id)
  return channel ? `${channel}:${str(args.thread_ts)}` : null
}

export function profileSection(md: string, audience: Audience): string | null {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${SECTION_TITLE[audience]}`)
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
  return !body || body === 'insufficient samples' ? null : body
}
