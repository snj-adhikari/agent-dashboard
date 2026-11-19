import type { Register } from 'claude-code'
import { install as balances } from './balances'
import { biasSessionStart, install as bias } from './bias'
import { blocksToolCall, install as blocks } from './blocks'
import { chainPromptSubmit, chainSessionStart, install as chain } from './chain'
import { install as commands, commandsSessionStart, commandsToolCall, commandsTurnComplete } from './commands'
import { install as files } from './files'
import { guardToolCall, install as guard } from './guard'
import { install as kudos, kudosPromptSubmit, kudosToolCall, kudosTurnComplete } from './kudos'
import { install as reminder, reminderPromptSubmit, reminderSessionStart } from './reminder'
import { install as strict, strictToolCheck } from './strict'
import { install as sync, syncClassicSessionStart, syncClassicSubagentStart, syncSessionStart, syncTurnComplete } from './sync'
import { install as tool, toolSessionStart } from './tool'

export const register: Register = (on, cfg) => {
  guard(on, cfg)
  commands(on, cfg)
  blocks(on, cfg)
  strict(on, cfg)
  reminder(on, cfg)
  balances(on, cfg)
  chain(on, cfg)
  tool(on, cfg)
  kudos(on, cfg)
  files(on, cfg)
  bias(on, cfg)
  sync(on, cfg)
  on('tool.call', ($, e, next) => guardToolCall($, e, x => blocksToolCall($, x, y => commandsToolCall($, y, z => kudosToolCall($, z, next, cfg), cfg), cfg), cfg))
  on('session.start', ($, e, next) => commandsSessionStart($, e, x => chainSessionStart($, x, y => reminderSessionStart($, y, z => toolSessionStart($, z, w => biasSessionStart($, w, v => syncSessionStart($, v, next, cfg), cfg), cfg), cfg), cfg), cfg))
  on('prompt.submit', ($, e, next) => chainPromptSubmit($, e, x => kudosPromptSubmit($, x, y => reminderPromptSubmit($, y, next, cfg), cfg), cfg))
  on('tool.check', ($, e, next) => strictToolCheck($, e, next, cfg))
  on('turn.complete', ($, e, next) => commandsTurnComplete($, e, x => kudosTurnComplete($, x, y => syncTurnComplete($, y, next, cfg), cfg), cfg))
  on('classic.SessionStart', ($, e, next) => syncClassicSessionStart($, e, next, cfg))
  on('classic.SubagentStart', ($, e, next) => syncClassicSubagentStart($, e, next, cfg))
}
