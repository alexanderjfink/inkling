/**
 * The two halves of the social side, as tabs.
 *
 * Notifications and friends are one area seen two ways: what has happened, and who it happened
 * with. Landing on the list of names made the second half look like the whole of it, so both
 * screens carry the same two buttons and the timeline is what a person arrives at.
 */
export function SocialTabs({
  view,
  onNotifications,
  onFriends,
}: {
  view: 'notifications' | 'friends'
  onNotifications: () => void
  onFriends: () => void
}) {
  const tabs: Array<{ id: 'notifications' | 'friends'; label: string; onSelect: () => void }> = [
    { id: 'notifications', label: 'notifications', onSelect: onNotifications },
    { id: 'friends', label: 'friends', onSelect: onFriends },
  ]

  return (
    <div className="flex items-center gap-1.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={view === tab.id ? 'page' : undefined}
          onClick={tab.onSelect}
          className={`rounded-full px-3.5 py-2 text-sm whitespace-nowrap ${
            view === tab.id ? 'bg-ink font-medium text-surface' : 'border border-line text-ink-soft'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
