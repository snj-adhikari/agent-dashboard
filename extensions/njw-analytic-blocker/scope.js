const CLAUDE_GROUP = /claude/i

const THIRD_PARTY_SEND = {
  id: 200,
  priority: 1,
  action: { type: 'block' },
  condition: {
    domainType: 'thirdParty',
    excludedRequestDomains: ['challenges.cloudflare.com'],
    resourceTypes: ['xmlhttprequest', 'ping', 'websocket', 'other']
  }
}

/** Block rules apply to requests initiated by the sites; the click-id redirect applies to navigations to them. */
function buildRules(base, tabIds, sites) {
  return [...base, THIRD_PARTY_SEND].map((r) => {
    const key = r.action.type === 'redirect' ? 'requestDomains' : 'initiatorDomains'
    return { ...r, condition: { ...r.condition, [key]: sites, tabIds } }
  })
}

if (typeof module !== 'undefined') module.exports = { CLAUDE_GROUP, buildRules }
