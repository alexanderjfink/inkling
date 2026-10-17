/**
 * Text with its links clickable.
 *
 * Somebody's note about the thing they noticed is often a page they found, and a URL rendered as
 * plain text is a URL you have to select by hand on a phone. Everything else is left exactly as
 * written — this is not a markdown renderer, it is one rule about one kind of thing.
 */
const URL = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g

export function Linkified({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split(URL)

  return (
    <span className={className}>
      {parts.map((part, index) =>
        URL.test(part) ? (
          <a
            key={`${part.slice(-24)}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline break-all"
          >
            {part.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        ),
      )}
    </span>
  )
}
