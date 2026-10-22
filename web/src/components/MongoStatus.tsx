import type { MongoStatus } from '../useMongoStatus'
import { Button } from './Card'
import { Modal } from './Modal'

export function MongoPulse({ status }: { status: MongoStatus }) {
  if (!status.state) return null
  const up = status.state.up
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400" title={up ? 'MongoDB is reachable' : status.state.error}>
      <span className={`inline-block h-2 w-2 rounded-full ${up ? 'animate-pulse bg-ok' : 'bg-danger'}`} />
      MongoDB {up ? 'up' : 'down'}
    </span>
  )
}

export function MongoAlerts({ status, hidePopup }: { status: MongoStatus; hidePopup?: boolean }) {
  if (!status.state || status.state.up) return null
  const detail = status.restartError ? `Restart failed: ${status.restartError}` : status.state.error
  const restart = (
    <Button primary loading={status.restarting} onClick={status.restart}>
      Restart MongoDB
    </Button>
  )
  return (
    <>
      <div
        role="alert"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200"
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium">MongoDB is down. History is not being saved.</div>
          <div className="break-words font-mono text-xs text-red-300">{detail}</div>
        </div>
        {restart}
      </div>
      {status.popup && !hidePopup && (
        <Modal onClose={status.dismiss}>
          <div className="mb-2 font-semibold text-red-300">MongoDB is down</div>
          <p className="mb-1 text-slate-300">History is not being saved while it is down. The dashboard works, but this period will have no history.</p>
          <div className="mb-3 break-words font-mono text-[11px] text-slate-400">{detail}</div>
          <div className="text-right">
            <Button onClick={status.dismiss}>Dismiss</Button>
            {restart}
          </div>
        </Modal>
      )}
    </>
  )
}
