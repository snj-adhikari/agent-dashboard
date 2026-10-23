import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Button } from './Card'
import { CopyLine } from './SetupFields'

type Status = Awaited<ReturnType<typeof api.tailscaleSetup>>

function Check({ ok, label, children }: { ok: boolean; label: string; children?: React.ReactNode }) {
  return (
    <li className="mb-1.5">
      <span className={ok ? 'text-ok' : 'text-slate-500'}>{ok ? '✓' : '○'}</span> <span className="text-slate-200">{label}</span>
      {!ok && children && <div className="ml-4 mt-1 text-[11px] text-slate-400">{children}</div>}
    </li>
  )
}

/** Shows what is missing for phone access over Tailscale and publishes the dashboard to the tailnet. */
export function TailscaleSetup({ onStatus }: { onStatus?: (serving: boolean) => void }) {
  const [st, setSt] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ error?: string; link?: string }>({})

  const refresh = useCallback(
    () =>
      api.tailscaleSetup().then((next) => {
        setSt(next)
        onStatus?.(next.serving)
      }),
    [onStatus]
  )

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  async function publish() {
    setBusy(true)
    setResult({})
    const r = await api.publishToTailnet()
    if (!r.ok) setResult({ error: r.error, link: r.link })
    await refresh()
    setBusy(false)
  }

  if (!st) return <p className="text-[11px] text-slate-500">Checking Tailscale...</p>
  const phoneUrl = st.host ? `https://${st.host}/m/` : ''

  return (
    <div className="text-xs">
      <ul className="mb-3">
        <Check ok={st.installed} label="Tailscale installed on this Mac">
          Install from{' '}
          <a className="text-sky-300 underline" href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">
            tailscale.com/download
          </a>
          , then sign in.
        </Check>
        <Check ok={st.running} label="Signed in and connected">
          Open the Tailscale app and connect. Use the same account on your phone.
        </Check>
        <Check ok={st.serving} label="Dashboard published to your tailnet only">
          <Button primary loading={busy} onClick={publish}>
            Publish to tailnet
          </Button>
          {result.link && (
            <p className="mt-1">
              Serve is off for your tailnet. Approve it once at{' '}
              <a className="text-sky-300 underline" href={result.link} target="_blank" rel="noopener noreferrer">
                this Tailscale link
              </a>
              , then publish again.
            </p>
          )}
          {result.error && !result.link && <p className="mt-1 text-red-300">{result.error}</p>}
        </Check>
      </ul>
      {st.serving && phoneUrl && (
        <>
          <p className="mb-1 text-slate-300">On your phone (Tailscale on), open:</p>
          <CopyLine text={phoneUrl} />
          <ul className="mt-2 list-disc pl-4 text-[11px] text-slate-400">
            <li>Android: tap Install app, or Chrome menu, Add to home screen, Install.</li>
            <li>iPhone: Safari, Share, Add to Home Screen (needed for notifications).</li>
            <li>Then tap Enable notifications and Test. Sessions need the agent-monitor-hook mod to notify.</li>
          </ul>
        </>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Step-by-step help: the prompts in <span className="font-mono">prompts/</span> can be pasted into Claude Code.
      </p>
    </div>
  )
}
