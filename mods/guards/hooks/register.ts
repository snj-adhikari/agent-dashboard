import type { Register } from 'claude-code'
import { check, DEFAULT_PROTECTED, leadingCd, needsBranch } from './rules'

export const register: Register = (on) => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const raw = await $.env.get('GUARDS_PROTECTED_BRANCHES')
    const protectedBranches = raw ? raw.split(',').map((b) => b.trim()).filter(Boolean) : DEFAULT_PROTECTED
    let branch = ''
    if (needsBranch(e.command)) {
      const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'], { cwd: leadingCd(e.command) })
      branch = exitCode === 0 ? stdout.trim() : ''
    }
    const reason = check(e.command, branch, protectedBranches)
    return reason ? { deny: `${$.plugin.name}: ${reason}` } : next(e)
  }).catch((_$, e, next) => next(e))
}
