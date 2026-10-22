const out = document.getElementById('out')

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function sessionLine(s) {
  const line = el('div', 'session', `● ${s.title} `)
  line.appendChild(el('small', '', s.meta))
  return line
}

function render({ total, repos, strays }) {
  out.replaceChildren()
  out.className = ''
  document.getElementById('total').textContent = `${total} agent session${total === 1 ? '' : 's'}`
  if (!total) return void Object.assign(out, { className: 'msg', textContent: 'No sessions running.' })
  for (const repo of repos) {
    const head = el('div', 'repo', repo.name)
    head.appendChild(el('small', '', `  ${repo.worktrees.length} active${repo.idle ? `, ${repo.idle} idle` : ''}`))
    out.appendChild(head)
    for (const wt of repo.worktrees) {
      const box = el('div', 'wt')
      const title = el('div', '')
      title.appendChild(el('span', 'branch', wt.branch + (wt.isMain ? ' (main checkout)' : '')))
      if (wt.changed) title.appendChild(el('span', 'changed', ` · ${wt.changed} changed`))
      box.appendChild(title)
      wt.sessions.forEach((s) => box.appendChild(sessionLine(s)))
      out.appendChild(box)
    }
  }
  if (strays.length) {
    out.appendChild(el('div', 'repo', 'Not in a known worktree'))
    strays.forEach((s) => out.appendChild(sessionLine({ ...s, meta: `${s.meta} · ${s.cwd}` })))
  }
}

fetchState()
  .then((state) => render(groupByRepo(state)))
  .catch(() => {
    out.className = 'err'
    out.textContent = `Could not reach the agent-monitor at ${MONITOR_URL}. Is it running?`
  })
