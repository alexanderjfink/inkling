import { renderMarkdown } from '../markdown'

/**
 * An Inkling's text, rendered as Markdown.
 *
 * Safe because `renderMarkdown` escapes the input before it applies any markup, so
 * nothing here can come from the note itself except text.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={`md ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  )
}
