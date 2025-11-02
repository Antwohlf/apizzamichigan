import React, { useCallback, useEffect, useState } from 'react'
import { BugReportModal } from './BugReportModal'
import { useSelectedPlace } from '../../store/selectedPlace'

function BugReportToast({ toast, onExpire }) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => {
      onExpire?.()
    }, toast.duration ?? 4000)
    return () => clearTimeout(timer)
  }, [toast, onExpire])

  if (!toast) return null
  return (
    <div
      className={`bug-report-toast bug-report-toast--${toast.variant || 'info'}`}
      role="status"
      aria-live="polite"
    >
      {toast.message}
    </div>
  )
}

export function BugReportFab() {
  const [isOpen, setIsOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const { selectedPlace } = useSelectedPlace()

  const showToast = useCallback((message, variant = 'info') => {
    setToast({ message, variant, duration: 4200 })
  }, [])

  const handleSuccess = useCallback(() => {
    showToast('Thanks—bug reported!', 'success')
    setIsOpen(false)
  }, [showToast])

  const handleError = useCallback(
    message => {
      showToast(message || 'Failed to submit bug report.', 'error')
    },
    [showToast]
  )

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <>
      {isOpen ? (
        <BugReportModal
          onClose={handleClose}
          onSuccess={handleSuccess}
          onError={handleError}
          selectedPlace={selectedPlace}
        />
      ) : null}
      <div className="bug-report-sidebar">
        <BugReportToast toast={toast} onExpire={() => setToast(null)} />
        <button
          type="button"
          aria-label="Report a bug"
          className="bug-report-sidebar__button"
          onClick={() => setIsOpen(true)}
        >
          Report a bug
        </button>
      </div>
    </>
  )
}
