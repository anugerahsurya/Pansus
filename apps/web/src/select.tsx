import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type SelectOption = { value: string; label: string; disabled?: boolean }

export function Select({ value, options, onChange, disabled, ariaLabel, placeholder, className, name }: {
  value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean;
  ariaLabel?: string; placeholder?: string; className?: string; name?: string;
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const selected = options.find(option => option.value === value)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function move(delta: number) {
    const enabled = options.filter(option => !option.disabled)
    if (!enabled.length) return
    const current = enabled.findIndex(option => option.value === value)
    const next = enabled[(current + delta + enabled.length) % enabled.length]
    if (next) onChange(next.value)
  }

  return <div ref={root} className={`react-select${className ? ` ${className}` : ''}`} data-open={open || undefined}>
    <select className="react-select-native" name={name} value={value} disabled={disabled} aria-label={ariaLabel} tabIndex={-1}
      onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
    <button ref={trigger} type="button" className="react-select-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      onClick={event => { event.preventDefault(); if (!disabled) setOpen(current => !current) }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) setOpen(true); else move(1) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); if (!open) setOpen(true); else move(-1) }
      }}>
      <span className="react-select-value">{selected?.label ?? placeholder ?? ''}</span>
      <ChevronDown size={15} className="react-select-chevron" aria-hidden="true" />
    </button>
    {open && <div id={listId} className="react-select-menu" role="listbox">
      {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled}
        className={`react-select-option${option.value === value ? ' selected' : ''}`}
        onClick={event => {
          event.preventDefault()
          if (option.disabled) return
          onChange(option.value)
          setOpen(false)
          trigger.current?.focus()
        }}>
        <span>{option.label}</span>
        {option.value === value && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}

