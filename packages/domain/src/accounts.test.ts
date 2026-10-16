import { describe, expect, test } from 'bun:test'
import {
  PASSWORD_MIN,
  PROFILE_COLORS,
  colorOf,
  defaultColor,
  USERNAME_MAX,
  USERNAME_MIN,
  isRole,
  usernameKey,
  validatePassword,
  validateUsername,
} from './accounts'

describe('validateUsername', () => {
  test('accepts ordinary names', () => {
    for (const name of ['sam', 'priya.desai', 'a_b-c', 'user99', 'Sam']) {
      expect(validateUsername(name)).toBeNull()
    }
  })

  test('an empty one is refused', () => {
    expect(validateUsername('')).toContain('required')
    expect(validateUsername('   ')).toContain('required')
  })

  test('length is bounded at both ends', () => {
    expect(validateUsername('ab')).toContain(String(USERNAME_MIN))
    expect(validateUsername('a'.repeat(USERNAME_MAX + 1))).toContain(String(USERNAME_MAX))
    expect(validateUsername('a'.repeat(USERNAME_MAX))).toBeNull()
  })

  test('surrounding space is ignored rather than rejected', () => {
    expect(validateUsername('  sam  ')).toBeNull()
  })

  test('a name that would be awkward in a URL or a path is refused', () => {
    for (const name of ['sam smith', 'sam/smith', '../etc', 'sam@host', 'sam?', 'é']) {
      expect(validateUsername(name)).not.toBeNull()
    }
  })

  test('it must not start with a dot or dash, which would look like a hidden file', () => {
    expect(validateUsername('.sam')).not.toBeNull()
    expect(validateUsername('-sam')).not.toBeNull()
  })
})

describe('validatePassword', () => {
  test('length is the only rule', () => {
    expect(validatePassword('correct horse battery staple')).toBeNull()
    expect(validatePassword('a'.repeat(PASSWORD_MIN))).toBeNull()
  })

  test('too short is refused, and says by how much', () => {
    expect(validatePassword('short')).toContain(String(PASSWORD_MIN))
    expect(validatePassword('')).toContain('required')
  })

  test('an absurd length is refused rather than hashed', () => {
    // Argon2 on a megabyte of input is a cheap way to make the server do expensive work.
    expect(validatePassword('a'.repeat(5000))).not.toBeNull()
  })
})

describe('usernameKey', () => {
  test('casing and padding do not make a second account', () => {
    expect(usernameKey('  Sam ')).toBe(usernameKey('sam'))
  })
})

describe('isRole', () => {
  test('only the two roles', () => {
    expect(isRole('admin')).toBe(true)
    expect(isRole('member')).toBe(true)
    expect(isRole('root')).toBe(false)
    expect(isRole(undefined)).toBe(false)
  })
})

describe('how somebody appears', () => {
  test('a colour is stable for the same account', () => {
    // It has to be: this is what makes a friend's suggestion recognisable at a glance, and
    // a colour that changed would be a colour that means nothing.
    expect(defaultColor('user-abc')).toBe(defaultColor('user-abc'))
  })

  test('and differs between accounts, which is the point of having one', () => {
    const colors = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(defaultColor),
    )
    expect(colors.size).toBeGreaterThan(3)
  })

  test('a chosen colour is used, and a nonsense one is not', () => {
    expect(colorOf({ id: 'user-abc', color: PROFILE_COLORS[3] })).toBe(PROFILE_COLORS[3])
    expect(colorOf({ id: 'user-abc', color: 'chartreuse' })).toBe(defaultColor('user-abc'))
    expect(colorOf({ id: 'user-abc' })).toBe(defaultColor('user-abc'))
  })

  test('every default is one of the colours on offer', () => {
    for (const id of ['a', 'bb', 'ccc', 'dddd', 'user-abc']) {
      expect(PROFILE_COLORS).toContain(defaultColor(id) as never)
    }
  })
})
