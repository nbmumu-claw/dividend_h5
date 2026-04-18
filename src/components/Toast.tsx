import { useState, useCallback } from 'react'

let globalShowToast: ((msg: string) => void) | null = null

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), 2000)
  }, [])

  return { message, showToast }
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="toast">{message}</div>
}
