import type { Register } from 'claude-code'
import { RULES } from './rules'

export const register: Register = (on) => {
  let attachedTo: string | undefined

  on('prompt.submit', async ($, e, next) => {
    const id = await $.session.id()
    if (id === attachedTo) return next(e)
    attachedTo = id
    return next({ ...e, context: [...(e.context ?? []), RULES] })
  }).catch((_$, e, next) => next(e))
}
