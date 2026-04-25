import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export default function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="modal-backdrop fade-in" onClick={onClose}>
      <div className="modal-sheet slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-sheet-body">
          {title && (
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
              <button onClick={onClose} className="text-gray-400 p-1">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
          {children}
        </div>
        {footer
          ? <div className="modal-sheet-footer">{footer}</div>
          : <div className="modal-sheet-footer-none" />
        }
      </div>
    </div>,
    document.body
  )
}
