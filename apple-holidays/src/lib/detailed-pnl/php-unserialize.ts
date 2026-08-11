/**
 * Minimal PHP `serialize()` reader.
 *
 * The Accounts app caches its Apple System content catalogues (attraction /
 * city_tour / excursion / vehicle id → name) in Laravel's *database* cache
 * store, and that store writes PHP-serialized values into `cache`.`value`.
 * Those maps are the only place an id like 5862 becomes "Pinnawala Elephant
 * Orphanage Ticket Only", so reading them is what keeps the Booking system's
 * Detailed P&L from printing "Attraction #5862" where Accounts prints a name.
 *
 * Only the types Laravel can put there for these maps are handled: array,
 * string, int, float, bool, null. Anything else (an object, a reference) makes
 * the parse fail rather than guess — callers treat a failed parse as "no
 * catalogue", which degrades to the id exactly as an un-synced catalogue does
 * on the Accounts side.
 */

export type PhpValue = string | number | boolean | null | PhpArray
export interface PhpArray { [key: string]: PhpValue }

class Cursor {
  constructor(public s: string, public i = 0) {}

  expect(ch: string): void {
    if (this.s[this.i] !== ch) {
      throw new Error(`php-unserialize: expected "${ch}" at ${this.i}, saw "${this.s[this.i] ?? '<eof>'}"`)
    }
    this.i++
  }

  /** Read up to (not including) `stop`, then consume it. */
  readUntil(stop: string): string {
    const at = this.s.indexOf(stop, this.i)
    if (at === -1) throw new Error(`php-unserialize: unterminated token at ${this.i}`)
    const out = this.s.slice(this.i, at)
    this.i = at + 1
    return out
  }
}

function parseValue(c: Cursor): PhpValue {
  const type = c.s[c.i]

  switch (type) {
    case 'N': {                       // N;
      c.i += 2
      return null
    }
    case 'b': {                       // b:0;
      c.i += 2
      const v = c.readUntil(';')
      return v === '1'
    }
    case 'i': {                       // i:42;
      c.i += 2
      return parseInt(c.readUntil(';'), 10)
    }
    case 'd': {                       // d:1.5;
      c.i += 2
      const raw = c.readUntil(';')
      if (raw === 'INF') return Infinity
      if (raw === '-INF') return -Infinity
      if (raw === 'NAN') return NaN
      return parseFloat(raw)
    }
    case 's': {                       // s:5:"hello";
      c.i += 2
      const len = parseInt(c.readUntil(':'), 10)
      c.expect('"')
      // The length is in BYTES, not UTF-16 code units, so a name carrying any
      // non-ASCII character (they do — "Bà Nà Hills") would be cut short by a
      // plain slice. Walk forward counting UTF-8 bytes instead.
      const out = readBytes(c, len)
      c.expect('"')
      c.expect(';')
      return out
    }
    case 'a': {                       // a:2:{i:0;s:1:"a";i:1;s:1:"b";}
      c.i += 2
      const count = parseInt(c.readUntil(':'), 10)
      c.expect('{')
      const arr: PhpArray = {}
      for (let n = 0; n < count; n++) {
        const key = parseValue(c)
        if (key === null || typeof key === 'boolean' || typeof key === 'object') {
          throw new Error('php-unserialize: unsupported array key type')
        }
        arr[String(key)] = parseValue(c)
      }
      c.expect('}')
      return arr
    }
    default:
      throw new Error(`php-unserialize: unsupported type "${type}" at ${c.i}`)
  }
}

/** Consume exactly `len` UTF-8 bytes from the cursor and return them as a string. */
function readBytes(c: Cursor, len: number): string {
  let bytes = 0
  const start = c.i
  while (bytes < len && c.i < c.s.length) {
    const code = c.s.codePointAt(c.i)!
    if (code > 0xffff) {              // surrogate pair — 4 UTF-8 bytes, 2 units
      bytes += 4
      c.i += 2
    } else {
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3
      c.i += 1
    }
  }
  if (bytes !== len) throw new Error('php-unserialize: string length overran the payload')
  return c.s.slice(start, c.i)
}

/**
 * Parse one PHP-serialized value. Returns null when the payload is not
 * something this reader supports — never throws at the caller.
 */
export function phpUnserialize(payload: string | null | undefined): PhpValue {
  if (typeof payload !== 'string' || payload === '') return null
  try {
    return parseValue(new Cursor(payload))
  } catch {
    return null
  }
}

/**
 * Flatten a parsed catalogue to `id → name`. The attraction / city_tour /
 * excursion maps are already that shape; the vehicle map holds a record per id
 * ({name, pax_min, pax_max, country}) and is left to the caller.
 */
export function asNameMap(value: PhpValue): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [id, name] of Object.entries(value)) {
    if (typeof name === 'string' && name.trim() !== '') out[id] = name.trim()
  }
  return out
}
