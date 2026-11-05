import { expect, mock, test } from 'claude-code/testing'

test('/factory brief runs the product team only for unclear requirements and the tech lead every run', async ($, on) => {
  const submitted: string[] = []
  const clock = mock.clock(on)
  on('ui.status', () => ({ value: undefined }) as never)
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('command.run', (_$, e) => e as never)
  const out = (await $.command.run({ command: 'factory', args: 'add dark mode' } as never)) as { text: string }
  await clock.advance(10)
  expect(out.text).toContain('FACTORY - The AI delivery team')
  const brief = submitted.join('\n')
  for (const a of ['product-analyst', 'design-lead', 'product-consultant', 'tech-lead']) expect(brief).toContain(`factory:${a}`)
  expect(brief).toContain('If they are clear, skip the product team: the tech lead and dev team deliver')
  expect(brief).toContain('Either way, dispatch factory:tech-lead')
  expect(brief.indexOf('factory:tech-lead')).toBeLessThan(brief.indexOf('factory:planner'))
  expect(brief).toContain('the product team owns what and why, the tech lead owns how')
  expect(brief).toContain('throwaway prototype')
  expect(brief).toContain('consult each other through you')
  expect(brief).toContain('Researchers serve both sides')
  expect(brief).toContain('mimics or takes inspiration from an existing product, dispatch factory:reverse-engineer')
})
