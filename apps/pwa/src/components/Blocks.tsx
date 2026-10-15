import type { Block, BlockKind, Blip } from '@inkling/domain'
import {
  BLOCK_KINDS,
  blockKindInfo,
  blockSummary,
  checklistCounts,
  newBlock,
  pollLeader,
  progressFraction,
  withItemAdded,
  withItemRemoved,
  withItemText,
  withProgress,
  withToggledItem,
  withTotal,
  withVote,
} from '@inkling/domain'
import { useState } from 'react'
import type { InklingActions } from '../state/useInkling'
import { StoredImage } from './StoredImage'

/**
 * Malleable structure.
 *
 * The shape follows what the blip becomes rather than the other way round: a question
 * that turns out to be a project gets a checklist, a link that turns out to be long
 * gets a reading tracker. Everything here writes an event, so it all syncs.
 */
export function Blocks({ blip, actions }: { blip: Blip; actions: InklingActions }) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function add(kind: BlockKind) {
    setBusy(`add:${kind}`)
    try {
      await actions.addBlock(blip.id, newBlock(kind))
      setPicking(false)
    } finally {
      setBusy(null)
    }
  }

  async function patch(blockId: string, change: Partial<Omit<Block, 'id'>>, key: string) {
    setBusy(key)
    try {
      await actions.updateBlock(blip.id, blockId, change)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex items-center gap-3">
        <p className="text-[11px] tracking-wide text-ink-faint uppercase">structure</p>
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          className="quiet ml-auto text-[11px] underline"
        >
          {picking ? 'cancel' : blip.blocks.length > 0 ? 'add another' : 'add one'}
        </button>
      </div>

      {picking ? (
        <ul className="mt-2 flex flex-col gap-1">
          {BLOCK_KINDS.map((info) => (
            <li key={info.kind}>
              <button
                type="button"
                onClick={() => void add(info.kind)}
                disabled={busy !== null}
                className="w-full rounded-xl border border-line p-2.5 text-left disabled:opacity-50"
              >
                <span className="text-xs font-medium">{info.label}</span>
                <span className="ml-2 text-[11px] text-ink-faint">{info.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {blip.blocks.length === 0 && !picking ? (
        <p className="mt-2 text-xs text-ink-faint">
          nothing yet — a checklist, a reading tracker, a poll, or a grid of images
        </p>
      ) : null}

      <ul className="mt-2 flex flex-col gap-3">
        {blip.blocks.map((block) => (
          <BlockCard
            key={block.id}
            block={block}
            busy={busy}
            onPatch={(change, key) => void patch(block.id, change, key)}
            onRemoveBlock={() => void actions.removeBlock(blip.id, block.id)}
            onStoreImage={(file) => actions.storeImage(file)}
          />
        ))}
      </ul>
    </div>
  )
}

function BlockCard({
  block,
  busy,
  onPatch,
  onRemoveBlock,
  onStoreImage,
}: {
  block: Block
  busy: string | null
  onPatch: (change: Partial<Omit<Block, 'id'>>, key: string) => void
  onRemoveBlock: () => void
  onStoreImage: (file: File) => Promise<{ hash: string; mime: string }>
}) {
  const info = blockKindInfo(block.kind)
  const rows = block.items

  return (
    <li className="rounded-2xl border border-line bg-surface/60 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-wide text-ink-faint uppercase">
            {info?.label ?? block.kind}
          </p>
          {block.title ? (
            <p className="mt-0.5 text-sm font-medium">{block.title}</p>
          ) : (
            <p className="mt-0.5 text-xs text-ink-faint">{blockSummary(block)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemoveBlock}
          aria-label="Remove this block"
          className="quiet px-1 text-xs leading-none"
        >
          ×
        </button>
      </div>

      {block.kind === 'checklist' ? (
        <Checklist block={block} busy={busy} onPatch={onPatch} />
      ) : null}
      {block.kind === 'readingProgress' ? (
        <ReadingProgress block={block} busy={busy} onPatch={onPatch} />
      ) : null}
      {block.kind === 'poll' ? <Poll block={block} busy={busy} onPatch={onPatch} /> : null}
      {block.kind === 'grid' ? (
        <Grid block={block} busy={busy} onPatch={onPatch} onStoreImage={onStoreImage} />
      ) : null}

      {block.kind !== 'readingProgress' && rows.length > 0 ? (
        <button
          type="button"
          onClick={() => onPatch({ items: withItemAdded(rows) }, `add:${block.id}`)}
          disabled={busy !== null}
          className="quiet mt-2 text-[11px] underline disabled:opacity-50"
        >
          add {info?.itemNoun ?? 'item'}
        </button>
      ) : null}
    </li>
  )
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <li className="flex items-start gap-2">
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this row"
          className="quiet px-1 text-[11px] leading-none"
        >
          ×
        </button>
      ) : null}
    </li>
  )
}

function Checklist({
  block,
  busy,
  onPatch,
}: {
  block: Block
  busy: string | null
  onPatch: (change: Partial<Omit<Block, 'id'>>, key: string) => void
}) {
  const counts = checklistCounts(block)
  return (
    <div className="mt-2">
      {counts ? (
        <div className="mb-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${(counts.done / counts.total) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-ink-faint">
            {counts.done}/{counts.total}
          </span>
        </div>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {block.items.map((item) => (
          <Row
            key={item.id}
            onRemove={
              block.items.length > 1
                ? () => onPatch({ items: withItemRemoved(block.items, item.id) }, `rm:${item.id}`)
                : undefined
            }
          >
            <button
              type="button"
              onClick={() =>
                onPatch({ items: withToggledItem(block.items, item.id) }, `toggle:${item.id}`)
              }
              disabled={busy !== null}
              aria-label={item.done ? 'Untick' : 'Tick'}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                item.done ? 'border-accent bg-accent text-surface' : 'border-line'
              }`}
            >
              {item.done ? '✓' : ''}
            </button>
            <input
              value={item.text ?? ''}
              onChange={(event) =>
                onPatch(
                  { items: withItemText(block.items, item.id, event.target.value) },
                  `t:${item.id}`,
                )
              }
              placeholder="a step"
              className={`min-w-0 flex-1 bg-transparent text-xs outline-none ${
                item.done ? 'text-ink-faint line-through' : 'text-ink-soft'
              }`}
            />
          </Row>
        ))}
      </ul>
    </div>
  )
}

function ReadingProgress({
  block,
  busy,
  onPatch,
}: {
  block: Block
  busy: string | null
  onPatch: (change: Partial<Omit<Block, 'id'>>, key: string) => void
}) {
  const fraction = progressFraction(block)
  const { current, total } = block.progress ?? { current: 0, total: 0 }

  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${(fraction ?? 0) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <label className="flex items-center gap-1 text-[11px] text-ink-faint">
          at
          <input
            type="number"
            inputMode="numeric"
            value={current}
            onChange={(event) =>
              onPatch({ progress: withProgress(block, Number(event.target.value)) }, 'cur')
            }
            className="w-14 rounded-lg border border-line bg-surface px-1.5 py-0.5 text-center text-xs text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-ink-faint">
          of
          <input
            type="number"
            inputMode="numeric"
            value={total || ''}
            placeholder="?"
            onChange={(event) =>
              onPatch({ progress: withTotal(block, Number(event.target.value)) }, 'total')
            }
            className="w-14 rounded-lg border border-line bg-surface px-1.5 py-0.5 text-center text-xs text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          onClick={() => onPatch({ progress: withProgress(block, current + 1) }, 'next')}
          disabled={busy !== null || (total > 0 && current >= total)}
          className="quiet ml-auto text-[11px] underline disabled:opacity-40"
        >
          +1
        </button>
      </div>
      {fraction === null ? (
        <p className="mt-1 text-[11px] text-ink-faint">set how long it is to get a bar</p>
      ) : null}
    </div>
  )
}

function Poll({
  block,
  busy,
  onPatch,
}: {
  block: Block
  busy: string | null
  onPatch: (change: Partial<Omit<Block, 'id'>>, key: string) => void
}) {
  const leader = pollLeader(block)
  const totalVotes = block.items.reduce((sum, item) => sum + (item.votes ?? 0), 0)

  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {block.items.map((item) => {
        const votes = item.votes ?? 0
        const share = totalVotes > 0 ? votes / totalVotes : 0
        const leading = leader?.id === item.id
        return (
          <Row
            key={item.id}
            onRemove={
              block.items.length > 1
                ? () => onPatch({ items: withItemRemoved(block.items, item.id) }, `rm:${item.id}`)
                : undefined
            }
          >
            <button
              type="button"
              onClick={() => onPatch({ items: withVote(block.items, item.id) }, `vote:${item.id}`)}
              disabled={busy !== null}
              className={`relative min-w-0 flex-1 overflow-hidden rounded-lg border px-2 py-1 text-left ${
                leading ? 'border-accent' : 'border-line'
              }`}
            >
              {/* The bar is the vote share, so a poll reads at a glance. */}
              <span
                className="absolute inset-y-0 left-0 bg-accent-soft"
                style={{ width: `${share * 100}%` }}
              />
              <span className="relative flex items-center gap-2">
                <input
                  value={item.text ?? ''}
                  onChange={(event) =>
                    onPatch(
                      { items: withItemText(block.items, item.id, event.target.value) },
                      `t:${item.id}`,
                    )
                  }
                  placeholder="an option"
                  className="min-w-0 flex-1 bg-transparent text-xs text-ink-soft outline-none"
                />
                <span className="shrink-0 text-[11px] text-ink-faint">{votes || ''}</span>
              </span>
            </button>
          </Row>
        )
      })}
      {totalVotes === 0 ? (
        <p className="text-[11px] text-ink-faint">tap an option to vote</p>
      ) : leader ? null : (
        <p className="text-[11px] text-ink-faint">tied — no leader yet</p>
      )}
    </ul>
  )
}

function Grid({
  block,
  busy,
  onPatch,
  onStoreImage,
}: {
  block: Block
  busy: string | null
  onPatch: (change: Partial<Omit<Block, 'id'>>, key: string) => void
  onStoreImage: (file: File) => Promise<{ hash: string; mime: string }>
}) {
  async function attach(itemId: string, file: File) {
    const stored = await onStoreImage(file)
    const items = block.items.map((item) =>
      item.id === itemId ? { ...item, mediaId: stored.hash, mime: stored.mime } : item,
    )
    onPatch({ items }, `img:${itemId}`)
  }

  return (
    <ul className="mt-2 grid grid-cols-2 gap-2">
      {block.items.map((item) => (
        <li key={item.id} className="flex flex-col gap-1">
          <label className="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-line bg-canvas">
            {item.mediaId ? (
              <StoredImage hash={item.mediaId} className="h-full w-full object-cover" />
            ) : (
              <span className="text-[11px] text-ink-faint">add image</span>
            )}
            <input
              type="file"
              accept="image/*"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void attach(item.id, file)
              }}
            />
          </label>
          <div className="flex items-center gap-1">
            <input
              value={item.text ?? ''}
              onChange={(event) =>
                onPatch(
                  { items: withItemText(block.items, item.id, event.target.value) },
                  `t:${item.id}`,
                )
              }
              placeholder="caption"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-ink-soft outline-none"
            />
            {block.items.length > 1 ? (
              <button
                type="button"
                onClick={() =>
                  onPatch({ items: withItemRemoved(block.items, item.id) }, `rm:${item.id}`)
                }
                aria-label="Remove this image"
                className="quiet px-1 text-[11px] leading-none"
              >
                ×
              </button>
            ) : null}
          </div>
        </li>
      ))}
      <li className="flex items-center">
        <button
          type="button"
          onClick={() => onPatch({ items: withItemAdded(block.items) }, `add:${block.id}`)}
          disabled={busy !== null}
          className="quiet text-[11px] underline disabled:opacity-50"
        >
          add image slot
        </button>
      </li>
    </ul>
  )
}

/** A count for the collapsed card, so structure is visible without opening it. */
export function blockCount(blip: Blip): string | null {
  if (blip.blocks.length === 0) return null
  const summaries = blip.blocks.map(blockSummary)
  if (summaries.length === 1) return summaries[0] ?? null
  return `${blip.blocks.length} blocks`
}
