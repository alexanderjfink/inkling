import { useRef, useState } from 'react'

/**
 * Moving between the cards of a round: a scroll, then a flick.
 *
 * Shared by the two review screens — your own Inklings, and a friend's — because paging is a
 * habit, not a layout: the same flick has to mean the same thing in both places or one of them
 * will feel broken. It was written inside the Review screen first, and this is that code moved
 * out unchanged apart from the names.
 */

const ROUND_AT = 64

export function useRoundSwipe({
  next,
  previous,
  hasNext,
  hasPrevious,
}: {
  next: () => void
  previous: () => void
  hasNext: boolean
  hasPrevious: boolean
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [pull, setPull] = useState<'down' | 'up' | null>(null)
  const [armed, setArmed] = useState(false)
  const from = useRef<number | null>(null)
  const engaged = useRef(false)

  const atTop = () => (cardRef.current?.scrollTop ?? 0) <= 0
  const atBottom = () => {
    const element = cardRef.current
    if (!element) return false
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 1
  }

  /**
   * A flick, and nothing less.
   *
   * The first version jumped the moment the card was at the end and anything tried to scroll
   * further — including the momentum of the scroll that had just arrived there. So reaching the
   * bottom of an Inkling immediately moved to the next one, and the bottom of the card could not
   * be read at all.
   *
   * What it takes now is a *separate* gesture that begins with the card already at the end. The
   * scroll that brings you there starts in the middle of the card, so it can never qualify; the
   * flick after it starts at the end, and has to travel this far to mean anything.
   */
  const FLICK_PX = 140
  const FLICK_WHEEL = 300
  /** Quiet for this long ends a wheel gesture — a mouse has no touchstart to tell us. */
  const GESTURE_GAP = 240

  const jumpedAt = useRef(0)
  const sliding = useRef<'down' | 'up' | null>(null)
  const [leaving, setLeaving] = useState<'down' | 'up' | null>(null)
  /** Which way the last flip went, so the new card can come in from the far side. */
  const [flip, setFlip] = useState<'down' | 'up'>('down')
  const canJump = () => Date.now() - jumpedAt.current > 650
  /**
   * A flip, with the card sliding out of the way first.
   *
   * Without it the next Inkling simply appeared, which is indistinguishable from the app having
   * jumped somewhere on its own. The card leaves in the direction the gesture was going, the
   * round moves on underneath, and the new one arrives from the other side.
   */
  const jump = (direction: 'down' | 'up') => {
    if (sliding.current) return
    jumpedAt.current = Date.now()
    sliding.current = direction
    setFlip(direction)
    setLeaving(direction)
    window.setTimeout(() => {
      if (direction === 'down') next()
      else previous()
      sliding.current = null
      setLeaving(null)
    }, 200)
  }

  const wheelAt = useRef(0)
  const wheelArmed = useRef<'down' | 'up' | null>(null)
  const wheelTravel = useRef(0)
  const touchFrom = useRef(0)
  const touchArmed = useRef<'down' | 'up' | null>(null)

  /** Which way a gesture that starts here could go, if it goes anywhere. */
  const armedNow = (): 'down' | 'up' | null => {
    if (atBottom() && hasNext) return 'down'
    if (atTop() && hasPrevious) return 'up'
    return null
  }

  const handlers = {
    /*
     * Scrolling, which is how somebody will actually try to move between cards. The card is the
     * scroll container, so the browser keeps the vertical gesture and never lets a pointer drag
     * finish — but it does hand us the wheel and the touch moves all the way to the end, and
     * "pulled hard past the end, having started there" is a good signal. `overscroll-contain`
     * keeps the page from taking the leftover.
     */
    onWheel: (event: React.WheelEvent) => {
      const now = Date.now()
      if (now - wheelAt.current > GESTURE_GAP) {
        wheelTravel.current = 0
        // Only a downward gesture can go on, and only an upward one can go back.
        const at = armedNow()
        wheelArmed.current =
          event.deltaY > 0 && at === 'down' ? 'down' : event.deltaY < 0 && at === 'up' ? 'up' : null
      }
      wheelAt.current = now

      const armed = wheelArmed.current
      if (!armed) return
      wheelTravel.current += Math.abs(event.deltaY)
      if (wheelTravel.current < FLICK_WHEEL || !canJump()) return
      wheelTravel.current = 0
      jump(armed)
    },
    onTouchStart: (event: React.TouchEvent) => {
      touchFrom.current = event.touches[0]?.clientY ?? 0
      touchArmed.current = armedNow()
    },
    onTouchMove: (event: React.TouchEvent) => {
      const armed = touchArmed.current
      if (!armed || !canJump()) return
      const moved = (event.touches[0]?.clientY ?? 0) - touchFrom.current
      if (armed === 'down' && moved <= -FLICK_PX) {
        touchArmed.current = null
        jump('down')
      }
      if (armed === 'up' && moved >= FLICK_PX) {
        touchArmed.current = null
        jump('up')
      }
    },
    onPointerDown: (event: React.PointerEvent) => {
      // A desktop scrolls with a wheel, and a mouse drag is how you select things.
      if (event.pointerType === 'mouse') return
      from.current = event.clientY
      engaged.current = false
      setPull(null)
      setArmed(false)
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (from.current === null) return
      const delta = event.clientY - from.current
      if (Math.abs(delta) < 12) return
      const lookingBack = delta > 0 && hasPrevious && atTop()
      const lookingOn = delta < 0 && hasNext && atBottom()
      engaged.current = lookingBack || lookingOn
      setPull(engaged.current ? (lookingBack ? 'down' : 'up') : null)
      setArmed(engaged.current && Math.abs(delta) >= ROUND_AT)
    },
    onPointerUp: () => {
      if (engaged.current && armed) {
        if (pull === 'down') previous()
        else next()
      }
      from.current = null
      engaged.current = false
      setPull(null)
      setArmed(false)
    },
    onPointerCancel: () => {
      from.current = null
      engaged.current = false
      setPull(null)
      setArmed(false)
    },
  }

  /** The card's own transform: out of the way when it is leaving, in from the side when it lands. */
  const slide = {
    transform: leaving ? `translateY(${leaving === 'down' ? '-14%' : '14%'})` : undefined,
    opacity: 1,
    transition: leaving ? 'transform 200ms ease' : 'transform 220ms ease-out',
  }

  return {
    cardRef,
    handlers,
    pull,
    armed,
    previous: () => jump('up'),
    next: () => jump('down'),
    slide,
    /** The class for the card arriving after a flip. */
    arrival: flip === 'down' ? 'card-in-next' : 'card-in-prev',
    showPrevious: hasPrevious,
    showNext: hasNext,
  }
}
