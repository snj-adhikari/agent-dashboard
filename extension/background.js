importScripts('sessions.js')

const REFRESH_MINUTES = 3

async function refreshBadge() {
  try {
    const { total } = groupByRepo(await fetchState())
    await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' })
    await chrome.action.setBadgeText({ text: total ? String(total) : '' })
  } catch {
    await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' })
    await chrome.action.setBadgeText({ text: '!' })
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refresh', { periodInMinutes: REFRESH_MINUTES })
  refreshBadge()
})
chrome.runtime.onStartup.addListener(refreshBadge)
chrome.alarms.onAlarm.addListener(refreshBadge)
