/**
 * The emoji & sticker catalogue.
 *
 * The Accounts system ships the identical list (public/js/chat.js), and a
 * sticker is nothing but an emoji sent on its own: it travels as ordinary
 * unicode text, so a sticker sent from either side is still a sticker on the
 * other — and stays readable even on a build that predates this feature. Only
 * the drawing differs: a message that is nothing but a glyph or three is
 * rendered large and bare, with no bubble around it.
 */

export interface EmojiGroup {
  key: string
  label: string
  glyphs: string[]
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  { key: 'smileys', label: 'Smileys', glyphs: [
    '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
    '😘','😗','😚','😋','😛','🤪','🤑','🤗','🤭','🤫','🤔','😐','😑','😶','😏','😒',
    '🙄','😬','🤥','😌','😔','😪','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴',
    '😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳',
    '🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱',
    '😤','😡','😠','🤬','😈','👿','💀','🤡','👻','👽','🤖','😺','😹','😻','🙈','🙉','🙊',
  ] },
  { key: 'gestures', label: 'People', glyphs: [
    '👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️',
    '🖖','👋','💪','🙏','👏','🙌','👐','🤲','🤝','✍️','💅','🤳','🧠','👀','👁️','👅',
    '👶','🧒','👦','👧','🧑','👨','👩','🧓','👴','👵','👮','👷','💂','🕵️','🧑‍⚕️','🧑‍🍳',
    '🧑‍💻','🧑‍💼','🧑‍✈️','🤷','🤦','🏃','🚶','🧍','💃','🕺','👫','👪','🦸','🦹','🧙','🎅',
  ] },
  { key: 'love', label: 'Love', glyphs: [
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
    '💘','💝','💟','♥️','💋','💌','🌹','💐','🎁','🎊','🥳','✨','🌟','💫','🔥','💯',
  ] },
  { key: 'animals', label: 'Animals', glyphs: [
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔',
    '🐧','🐦','🐤','🦅','🦆','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞',
    '🐜','🕷️','🐢','🐍','🐙','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🦓','🦍','🐘',
    '🦏','🐪','🦙','🐑','🐕','🐈','🕊️','🌵','🌴','🌳','🌲','🍀','🌿','🌻','🌷','🌸',
  ] },
  { key: 'food', label: 'Food', glyphs: [
    '🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥕',
    '🌽','🌶️','🥔','🍞','🥐','🥖','🧀','🥚','🍳','🥞','🥓','🍖','🍗','🍔','🍟','🍕',
    '🌭','🥪','🌮','🌯','🥗','🥘','🍝','🍜','🍚','🍛','🍣','🍱','🍘','🍥','🥠','🍪',
    '🎂','🍰','🧁','🍫','🍬','🍭','🍦','🍧','☕','🍵','🥛','🍶','🍷','🍺','🍻','🥂',
  ] },
  { key: 'travel', label: 'Travel', glyphs: [
    '✈️','🛫','🛬','🧳','🗺️','🧭','🏖️','🏝️','🏕️','⛰️','🌋','🏞️','🏛️','🏠','🏨','🏩',
    '🏬','🏯','🏰','🗼','🗽','⛪','🕌','🛕','🌉','🎡','🎢','🚂','🚆','🚌','🚐','🚗',
    '🚙','🚎','🏍️','🛥️','⛵','🚤','🛳️','⚓','🚀','🛸','🌍','🌎','🌏','☀️','🌤️','⛅',
    '🌧️','⛈️','❄️','🌈','🌅','🌆','🌃','🗿',
  ] },
  { key: 'work', label: 'Work', glyphs: [
    '💼','🗂️','📁','📄','📝','📋','📊','📈','📉','💰','💵','💸','💳','🧾','🏷️','📧',
    '📨','📩','📮','📬','📅','📆','⏰','⏳','📞','📱','💻','🖥️','🖨️','⌨️','📌','📎',
    '🖇️','✂️','🔒','🔑','🔍','💡','🧮','🎯','🏆','🏅','🥇','⚽','🏀','🎾','🎮','🚦',
  ] },
  { key: 'symbols', label: 'Symbols', glyphs: [
    '✅','❌','❗','❓','⚠️','🚫','⛔','🆗','🆙','🆕','🆓','♻️','🔃','▶️','⏸️','⏭️',
    '⬆️','⬇️','➡️','⬅️','🔄','➕','➖','✖️','♾️','⭐','🌟','💥','💢','💤','💦','💨',
    '🔔','🔕','📢','📣','🛎️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🔲','💬','💭',
  ] },
]

/** The big, loud ones — sent on their own, never typed into a sentence. */
export const STICKERS = [
  '👍','👏','🙌','🤝','💪','🙏','🤣','😂','😭','🤩','😎','🥴','🤯','🥱','😴','🤔',
  '🙄','🤫','😅','🥹','🫡','🫠','🥳','🎉','🎊','🍾','🎂','🎁','✅','❌','🔥','💯',
  '🚀','⭐','✨','👀','⏰','💰','📈','📉','☕','🍻','🎯','🏆','🐱','🐶','🦄','🌈',
]

// Built inside a try/catch: a browser without unicode property escapes throws
// while parsing it, and one missing flourish must not take the chat down.
let EMOJI_ONLY: RegExp | null = null
try {
  EMOJI_ONLY = new RegExp('^(?:[\\p{Extended_Pictographic}\\p{Emoji_Component}\\u200d\\ufe0f]|\\s)+$', 'u')
} catch { EMOJI_ONLY = null }

/**
 * How many glyphs to draw jumbo — 0 means "an ordinary bubble".
 *
 * Three is the cut-off: past that it is a sentence written in emoji, and a wall
 * of 44px glyphs is unreadable.
 */
export function jumboCount(body: string | null | undefined): number {
  if (!body || !EMOJI_ONLY) return 0
  const text = body.trim()
  if (!text || !EMOJI_ONLY.test(text)) return 0

  let n = 0
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Segmenter) {
    // Segmenter counts 👨‍👩‍👧 as the one glyph it is drawn as. Walked by hand
    // rather than with for..of, which this tsconfig's target cannot downlevel.
    const segments = new Segmenter(undefined, { granularity: 'grapheme' }).segment(text) as unknown as {
      [Symbol.iterator](): Iterator<{ segment: string }>
    }
    const it = segments[Symbol.iterator]()
    for (let r = it.next(); !r.done; r = it.next()) if (r.value.segment.trim()) n++
  } else {
    n = Array.from(text.replace(/\s+/g, '')).length
  }
  return n > 0 && n <= 3 ? n : 0
}

const RECENT_KEY = 'ops.chat.recentEmoji'

/** The emoji last used, newest first — per browser, not per server. */
export function recentEmoji(add?: string): string[] {
  if (typeof window === 'undefined') return []
  let list: string[] = []
  try { list = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') ?? [] } catch { list = [] }
  if (add) {
    list = [add, ...list.filter(g => g !== add)].slice(0, 24)
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* private mode */ }
  }
  return list
}
