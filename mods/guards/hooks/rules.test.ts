import { expect, test } from 'claude-code/testing'
import { check, DEFAULT_PROTECTED, leadingCd, needsBranch, pushTargets } from './rules'

const blocked = (cmd: string, branch = 'feat/x') => check(cmd, branch, DEFAULT_PROTECTED) !== undefined

test('blocks every form of force push', () => {
  for (const cmd of ['git push --force', 'git push -f origin feat/x', 'git push --force-with-lease', 'git push origin +feat/x', 'git push -uf origin feat/x']) {
    expect(blocked(cmd)).toBe(true)
  }
  expect(blocked('git push -u origin feat/x')).toBe(false)
})

test('blocks pushes that land on a protected branch', () => {
  expect(blocked('git push origin main')).toBe(true)
  expect(blocked('git push origin HEAD:develop')).toBe(true)
  expect(blocked('git push', 'main')).toBe(true)
  expect(blocked('git push origin feat/x', 'main')).toBe(false)
  expect(pushTargets(' -u origin feat/x')).toEqual(['feat/x'])
})

test('blocks commits only on protected branches', () => {
  expect(blocked('git commit -m "x"', 'main')).toBe(true)
  expect(blocked('git commit -m "x"', 'feat/x')).toBe(false)
  expect(blocked('git commit -m "x"', 'release')).toBe(false)
  expect(check('git commit -m x', 'release', ['release'])).toBeDefined()
})

test('blocks rm -rf on root, home and parent, allows project folders', () => {
  for (const cmd of ['rm -rf /', 'rm -rf ~', 'rm -fr ~/', 'rm -rf "$HOME"', 'rm -r -f /*', 'rm -rf ..']) {
    expect(blocked(cmd)).toBe(true)
  }
  expect(blocked('rm -rf node_modules dist')).toBe(false)
  expect(blocked('rm -rf ./build')).toBe(false)
})

test('reads the folder from a leading cd and only looks up the branch when needed', () => {
  expect(leadingCd('cd "/tmp/my repo" && git commit -m x')).toBe('/tmp/my repo')
  expect(leadingCd('git status')).toBeUndefined()
  expect(needsBranch('git commit -m x')).toBe(true)
  expect(needsBranch('git push origin feat/x')).toBe(false)
  expect(needsBranch('ls')).toBe(false)
})
