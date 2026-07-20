import React, { useEffect, useRef } from 'react'

export default function AdminConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    confirmRef.current?.focus()
    const handleKeyDown = event => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, open])

  if (!open) return null

  return (
    <div
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancel()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: '1rem',
        background: 'rgba(2, 6, 23, 0.78)',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        aria-describedby="admin-confirm-message"
        style={{
          width: 'min(100%, 32rem)',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          borderRadius: 8,
          background: '#111827',
          color: '#f8fafc',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
          padding: '1.25rem',
        }}
      >
        <h2 id="admin-confirm-title" style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2>
        <p id="admin-confirm-message" style={{ margin: '0.8rem 0 1.2rem', color: '#cbd5e1', whiteSpace: 'pre-line', lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={onCancel} style={{ border: '1px solid #475569', borderRadius: 6, background: 'transparent', color: '#e2e8f0', padding: '0.55rem 0.8rem', cursor: 'pointer' }}>{cancelLabel}</button>
          <button ref={confirmRef} type="button" onClick={onConfirm} style={{ border: `1px solid ${danger ? '#f87171' : '#fb923c'}`, borderRadius: 6, background: danger ? '#7f1d1d' : '#f97316', color: '#fff', padding: '0.55rem 0.8rem', fontWeight: 700, cursor: 'pointer' }}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
