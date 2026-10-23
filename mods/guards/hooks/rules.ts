export const DEFAULT_PROTECTED = ['main', 'master', 'develop', 'staging']

const FORCE_PUSH = /\bgit\s+push\b[^;&|]*?(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+[\w./:-]+)/
const PUSH = /\bgit\s+push\b([^;&|]*)/
const COMMIT = /\bgit\s+commit\b/
const RM_RF = /\brm\s+(-[a-zA-Z]*(r[a-zA-Z]*f|f[a-zA-Z]*r)[a-zA-Z]*|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\s+([^;&|]+)/
const DANGEROUS_TARGET = /^(\/|\/\*|~\/?|~\/\*|"?\$HOME"?\/?|"?\$HOME\/\*"?|\.\.?\/?)$/

/** Leading `cd <dir> &&` sets the folder the git commands run in. */
export function leadingCd(command: string): string | undefined {
  const m = command.match(/^\s*cd\s+("([^"]+)"|'([^']+)'|(\S+))\s*&&/)
  return m ? m[2] || m[3] || m[4] : undefined
}

/** Branch names a `git push` explicitly targets, e.g. `origin main` or `HEAD:main`. */
export function pushTargets(args: string): string[] {
  const words = args.trim().split(/\s+/).filter((w) => w && !w.startsWith('-'))
  return words.slice(1).map((w) => w.replace(/^\+/, '').split(':').pop() || '').filter(Boolean)
}

export const needsBranch = (command: string): boolean => COMMIT.test(command) || (PUSH.test(command) && !pushTargets(PUSH.exec(command)?.[1] || '').length)

/** Why the command must not run, or undefined when it may. */
export function check(command: string, branch: string, protectedBranches: string[]): string | undefined {
  if (FORCE_PUSH.test(command)) return 'force push is blocked; push normally, or run it yourself if you really mean to rewrite history'
  const push = PUSH.exec(command)
  if (push) {
    const targets = pushTargets(push[1])
    const hit = (targets.length ? targets : [branch]).find((b) => protectedBranches.includes(b))
    if (hit) return `pushing to protected branch ${hit} is blocked; push a feature branch and open a PR`
  }
  if (COMMIT.test(command) && protectedBranches.includes(branch)) return `committing on protected branch ${branch} is blocked; create a feature branch first`
  const rm = RM_RF.exec(command)
  if (rm && rm[3].trim().split(/\s+/).some((t) => DANGEROUS_TARGET.test(t))) return 'rm -rf on the root, home or parent folder is blocked'
  return undefined
}
