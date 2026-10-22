import { useState } from 'react'
import { CopyLine, Field, TextInput } from './SetupFields'
import { Button } from './Card'

export const CMUX_SECRET = 'CMUX_SOCKET_PASSWORD'

const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')

const snippet = (token: string) => `{
  "automation": {
    "socketControlMode": "password",
    "socketPassword": "${token || '<your token>'}"
  }
}`

export function CmuxSocketGuide({ token, onChange }: { token: string; onChange: (v: string) => void }) {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })

  return (
    <details className="mb-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-200">cmux socket access</summary>
      <p className="mt-2 text-[11px] text-slate-400">
        A background service is not a child of cmux, so by default cmux refuses it and the dashboard shows 0 cmux tabs. Give cmux a password and pass the same token to the service.
      </p>
      <p className="mt-2 text-[11px] font-medium text-slate-300">Step 1. Add this to ~/.config/cmux/cmux.json (back it up first), then run <code>cmux reload-config</code>.</p>
      <pre className="my-1 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-200">{snippet(token)}</pre>
      <button type="button" onClick={() => copy(snippet(token))} className="mb-3 text-[11px] text-sky-300 hover:underline">
        {copied ? 'Copied' : 'Copy snippet'}
      </button>
      <p className="mb-1 text-[11px] font-medium text-slate-300">Step 2. Set the token below. It is written to the plist as {CMUX_SECRET} and never stored in the database.</p>
      <Field label={CMUX_SECRET} hint="Leave blank to keep the value already in the plist.">
        <TextInput type="password" value={token} onChange={onChange} placeholder="Token" />
      </Field>
      <div className="flex items-center gap-2">
        <Button onClick={() => onChange(newToken())}>Generate token</Button>
        {token && <CopyLine text={token} />}
      </div>
    </details>
  )
}
