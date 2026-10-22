import { useState, type ReactNode } from 'react'

export const inputClass =
  'w-full box-border rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-brand disabled:opacity-50'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  onBlur
}: {
  value: string | number
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number'
  onBlur?: () => void
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={inputClass}
    />
  )
}

export function ChipList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')

  function add() {
    const next = draft.trim()
    if (next && !value.includes(next)) onChange([...value, next])
    setDraft('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5">
      {value.map((chip) => (
        <span key={chip} className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-200">
          {chip}
          <button
            type="button"
            aria-label={`Remove ${chip}`}
            onClick={() => onChange(value.filter((c) => c !== chip))}
            className="text-slate-500 hover:text-slate-200"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder ?? 'Type and press Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
        className="min-w-[120px] flex-1 bg-transparent text-sm text-slate-100 outline-none"
      />
    </div>
  )
}

/** Editable table of string rows, seeded once from `rows` and held locally so blank rows survive until the parent drops them on save; `after` renders per-row extras such as validation. */
export function RowsEditor({
  columns,
  rows: initial,
  onChange: emit,
  after
}: {
  columns: string[]
  rows: string[][]
  onChange: (rows: string[][]) => void
  after?: (row: string[], i: number) => ReactNode
}) {
  const [rows, setRows] = useState(initial)
  const onChange = (next: string[][]) => {
    setRows(next)
    emit(next)
  }
  const update = (i: number, c: number, v: string) => onChange(rows.map((r, ri) => (ri === i ? r.map((x, ci) => (ci === c ? v : x)) : r)))

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} className="mb-1.5">
          <div className="flex items-center gap-1.5">
            {columns.map((col, c) => (
              <input
                key={col}
                value={row[c] ?? ''}
                placeholder={col}
                aria-label={col}
                onChange={(e) => update(i, c, e.target.value)}
                className={inputClass}
              />
            ))}
            <button
              type="button"
              aria-label="Remove row"
              onClick={() => onChange(rows.filter((_, ri) => ri !== i))}
              className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            >
              ×
            </button>
          </div>
          {after?.(row, i)}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, columns.map(() => '')])}
        className="text-[11px] font-medium text-sky-300 hover:underline"
      >
        + Add row
      </button>
    </div>
  )
}

export function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mb-1 flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-300">
      <code className="min-w-0 flex-1 break-all">{text}</code>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }
        className="shrink-0 text-[10px] font-sans text-sky-300 hover:underline"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export const toRows = (rec: Record<string, string> | undefined): string[][] => Object.entries(rec ?? {})

export const fromRows = (rows: string[][]): Record<string, string> =>
  Object.fromEntries(rows.filter((r) => r[0]?.trim()).map((r) => [r[0].trim(), (r[1] ?? '').trim()]))
