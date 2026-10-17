import type { ReactNode } from 'react'

/**
 * The pieces settings screens are made of.
 *
 * Shared because there are now two of them — the account's own settings, and the model
 * settings that belong to the server and therefore live on the admin screen. Two copies of
 * `Field` would be two things to keep in step for no reason.
 */

export const inputClass =
  'w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent'
export const buttonClass =
  'self-start rounded-full border border-line px-4 py-2 text-xs font-medium disabled:opacity-40'
export const primaryButtonClass =
  'self-start rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40'

export function Section({
  title,
  children,
  hint,
}: {
  title: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-xs tracking-wide text-ink-faint uppercase">{title}</h2>
      {children}
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs tracking-wide text-ink-faint uppercase">{label}</span>
      {children}
    </label>
  )
}

const CUSTOM = '__custom__'

/**
 * A model field that becomes a real dropdown once the list is known.
 *
 * A `<datalist>` looks like a dropdown in a design tool and behaves like one almost nowhere,
 * especially on a phone. This is an actual `<select>`, with a way back to typing for models
 * the provider does not list — which happens with local runners.
 */
export function ModelPicker({
  label,
  value,
  options,
  onChange,
  custom,
  onCustomChange,
  loading,
  onLoad,
  placeholder,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  custom: boolean
  onCustomChange: (custom: boolean) => void
  loading: boolean
  onLoad: () => void
  placeholder: string
}) {
  const listed = value && !options.includes(value) ? [value, ...options] : options

  return (
    <Field label={options.length > 0 ? `${label} · ${options.length} available` : label}>
      {options.length > 0 && !custom ? (
        <select
          value={value}
          onChange={(event) => {
            if (event.target.value === CUSTOM) {
              onCustomChange(true)
              return
            }
            onChange(event.target.value)
          }}
          className={inputClass}
        >
          {value ? null : <option value="">— choose a model —</option>}
          {listed.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
          <option value={CUSTOM}>— type a model that is not listed —</option>
        </select>
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={inputClass}
        />
      )}

      <span className="flex gap-3 text-xs text-ink-faint">
        <button
          type="button"
          onClick={onLoad}
          disabled={loading}
          className="underline disabled:opacity-40"
        >
          {loading ? 'loading…' : options.length > 0 ? 'reload the list' : 'load the models'}
        </button>
        {custom && options.length > 0 ? (
          <button type="button" onClick={() => onCustomChange(false)} className="underline">
            back to the list
          </button>
        ) : null}
      </span>
    </Field>
  )
}
