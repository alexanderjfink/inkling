import { describe, expect, test } from 'bun:test'
import {
  PASSWORD_MIN,
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
