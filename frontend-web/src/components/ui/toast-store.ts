export type ToastVariant = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  title: string
  description?: string
  variant: ToastVariant
  duration: number
}

type Listener = (toasts: Toast[]) => void

let seq = 1
let toasts: Toast[] = []
const listeners = new Set<Listener>()
const timers = new Map<number, number>()

function emit() {
  for (const listener of listeners) {
    listener([...toasts])
  }
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToasts(): Toast[] {
  return toasts
}

export function pushToast(input: {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
}): number {
  const toast: Toast = {
    id: seq++,
    title: input.title,
    description: input.description,
    variant: input.variant ?? 'info',
    duration: input.duration ?? 3200,
  }

  toasts = [...toasts, toast]
  emit()

  const timer = window.setTimeout(() => dismissToast(toast.id), toast.duration)
  timers.set(toast.id, timer)
  return toast.id
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id)

  const timer = timers.get(id)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timers.delete(id)
  }

  emit()
}

export const toast = {
  success: (title: string, description?: string) =>
    pushToast({ title, description, variant: 'success' }),
  error: (title: string, description?: string) =>
    pushToast({ title, description, variant: 'error' }),
  info: (title: string, description?: string) =>
    pushToast({ title, description, variant: 'info' }),
}
