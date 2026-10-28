import { Avatar } from './Avatar'

/**
 * The desktop's standing navigation.
 *
 * On a phone every destination is a screen you arrive at and leave; on a wide screen they are
 * places that stay put. The rail is what makes the wide layout feel like a room rather than a
 * stretched phone: you can see where you are, and where else you could be, without pressing back.
 */
/** Every place the shell can be — including the two the rail never navigates to itself. */
export type RailScreen =
  | 'add'
  | 'review'
  | 'all'
  | 'friends'
  | 'friend'
  | 'friends-review'
  | 'settings'
  | 'you'
  | 'notifications'
  | 'help'

const ITEMS: Array<{ screen: RailScreen; label: string; glyph: string }> = [
  { screen: 'add', label: 'New Inkling', glyph: '✎' },
  { screen: 'review', label: 'Review', glyph: '◐' },
  { screen: 'all', label: 'All Inklings', glyph: '▤' },
  { screen: 'friends', label: 'Friends', glyph: '☺' },
  { screen: 'you', label: 'You', glyph: '◔' },
]

export function Rail({
  screen,
  onGo,
  socialOn,
  friendsWaiting,
  userId,
  username,
  userColor,
  userAvatar,
}: {
  screen: RailScreen
  onGo: (screen: RailScreen) => void
  /** Friends and You only mean something when there are people to be social with. */
  socialOn: boolean
  friendsWaiting: number
  userId?: string
  username: string
  userColor?: string
  userAvatar?: string
}) {
  const items = ITEMS.filter(
    (item) => socialOn || (item.screen !== 'friends' && item.screen !== 'you'),
  )

  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 flex h-dvh w-56 shrink-0 flex-col gap-1 border-line border-r px-4 py-6"
    >
      <button
        type="button"
        onClick={() => onGo('add')}
        className="mb-4 flex items-center gap-2.5 rounded-xl px-3 py-1 text-left"
      >
        <img src="/icon-192.png" alt="" width={28} height={28} className="h-7 w-7 rounded-lg" />
        <span className="text-lg font-semibold tracking-tight">Inkling</span>
      </button>

      {items.map((item) => {
        // A friend's screen and the notifications are both "Friends" as far as the rail is
        // concerned: the section you are in, not the exact page.
        const active =
          screen === item.screen ||
          (item.screen === 'friends' && (screen === 'friend' || screen === 'notifications'))
        return (
          <button
            key={item.screen}
            type="button"
            onClick={() => onGo(item.screen)}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-surface ${
              active ? 'bg-accent-soft font-medium text-accent' : 'text-ink-soft'
            }`}
          >
            <span aria-hidden className="w-5 shrink-0 text-center">
              {item.glyph}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.screen === 'friends' && friendsWaiting > 0 ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-surface">
                {friendsWaiting}
              </span>
            ) : null}
          </button>
        )
      })}

      <div className="mt-auto flex flex-col gap-1">
        <button
          type="button"
          onClick={() => onGo('settings')}
          aria-current={screen === 'settings' ? 'page' : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-surface ${
            screen === 'settings' ? 'bg-accent-soft font-medium text-accent' : 'text-ink-soft'
          }`}
        >
          <span aria-hidden className="w-5 shrink-0 text-center">
            ⚙
          </span>
          <span>Settings</span>
        </button>

        {/* Who you are, where you can see it — the way it is on the entry screen. */}
        {socialOn ? (
          <button
            type="button"
            onClick={() => onGo('you')}
            className="mt-2 flex items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-surface"
          >
            <Avatar
              userId={userId}
              username={username}
              color={userColor}
              hash={userAvatar}
              size={28}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{username}</span>
          </button>
        ) : null}
      </div>
    </nav>
  )
}
