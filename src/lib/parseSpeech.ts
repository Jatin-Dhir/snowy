// Turns one spoken sentence into a transaction — fully on-device, no network.
// "250 shopping" · "₹90 chai from cash" · "got 2000 from rahul" all work.
import type { Category, Txn } from '../db/db'
import { guessCategory } from './smart'

export interface ParsedSpeech {
  amountMinor: number | null
  kind: 'out' | 'in'
  note: string
  categoryId: string | null
}

// everyday words → seed tag ids (only applied if that tag still exists)
const SYNONYMS: Record<string, string[]> = {
  food: ['food', 'lunch', 'dinner', 'breakfast', 'chai', 'tea', 'coffee', 'snack', 'snacks', 'pizza', 'burger', 'biryani', 'swiggy', 'zomato', 'restaurant', 'tiffin', 'momos', 'dosa', 'thali'],
  groceries: ['groceries', 'grocery', 'sabzi', 'vegetables', 'fruits', 'milk', 'zepto', 'blinkit', 'bigbasket', 'dmart', 'kirana', 'ration'],
  shopping: ['shopping', 'clothes', 'shoes', 'dress', 'shirt', 'jeans', 'myntra', 'mall'],
  online: ['amazon', 'flipkart', 'online'],
  transport: ['transport', 'uber', 'ola', 'auto', 'cab', 'taxi', 'bus', 'train', 'metro', 'petrol', 'diesel', 'fuel', 'rapido', 'rickshaw'],
  bills: ['bill', 'bills', 'recharge', 'electricity', 'wifi', 'broadband', 'mobile', 'postpaid', 'prepaid', 'gas', 'water'],
  entertainment: ['movie', 'movies', 'netflix', 'spotify', 'game', 'games', 'concert', 'show', 'tickets'],
  health: ['medicine', 'medicines', 'doctor', 'pharmacy', 'hospital', 'gym', 'protein', 'chemist'],
  rent: ['rent', 'landlord'],
  salary: ['salary', 'wage', 'stipend'],
  return: ['refund', 'cashback', 'returned', 'return']
}

const IN_CUES = /\b(received|receive|got|got back|credited|refund|cashback|salary|gave me|sent me|paid me|returned)\b/
// "from rahul" means money came in; "from cash" / "from my card" only says how it was paid
const FROM_SOMEONE = /\bfrom\s+(?!(?:my\s+)?(?:cash|upi|card|credit|debit|wallet|bank|account|paytm|gpay|phonepe)\b)[a-z]/
const OUT_CUES = /\b(spent|paid|bought|purchase[d]?|gave|sent|order(ed)?)\b/
const FILLERS = new Set([
  'i', 'a', 'an', 'the', 'on', 'for', 'of', 'at', 'in', 'to', 'my', 'me', 'it', 'is', 'was', 'and', 'just',
  'spent', 'paid', 'bought', 'add', 'log', 'note', 'oh', 'god', 'um', 'uh', 'please', 'like', 'some', 'today',
  'rupees', 'rupee', 'rs', 'inr', 'bucks', 'dollars', 'from', 'received', 'got', 'expense'
])

// The recognizer sometimes spells amounts out: "two fifty", "fifteen hundred",
// "two thousand five hundred", "one lakh". Used only when no digits were heard.
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, k: 1000, lakh: 1e5, lakhs: 1e5, lac: 1e5, crore: 1e7, crores: 1e7 }

function valueOfWords(words: string[]): number {
  let total = 0
  let current = 0
  let afterGroup = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w === 'and' || w === 'a') continue
    if (w in SCALES) {
      if (SCALES[w] === 100) current = (current || 1) * 100
      else {
        total += (current || 1) * SCALES[w]
        current = 0
      }
      afterGroup = false
      continue
    }
    let group = TENS[w] ?? UNITS[w]
    const next = UNITS[words[i + 1]]
    if (w in TENS && next > 0 && next < 10) {
      group += next // "ninety nine"
      i++
    }
    // two groups back to back is how prices are said: "two fifty" = 250, "four ninety nine" = 499
    current = afterGroup ? current * 100 + group : current + group
    afterGroup = true
  }
  return total + current
}

function spokenAmount(text: string): { minor: number; rest: string } | null {
  const tokens = [...text.matchAll(/[a-z]+/g)]
  const isNumber = (w: string) => w in UNITS || w in TENS || w in SCALES
  let best: { value: number; start: number; end: number } | null = null
  for (let i = 0; i < tokens.length; i++) {
    if (!isNumber(tokens[i][0]) && !(tokens[i][0] === 'a' && tokens[i + 1]?.[0] in SCALES)) continue
    let j = i
    // a run of number words, allowing "and" between them and "a" before "hundred"/"lakh"
    while (
      j + 1 < tokens.length &&
      (isNumber(tokens[j + 1][0]) ||
        (tokens[j + 1][0] === 'and' && isNumber(tokens[j + 2]?.[0] ?? '')) ||
        (tokens[j + 1][0] === 'a' && tokens[j + 2]?.[0] in SCALES))
    )
      j++
    const value = valueOfWords(tokens.slice(i, j + 1).map((t) => t[0]))
    // several numbers in one sentence ("one coffee, two fifty"): the biggest is the price
    if (value > 0 && (!best || value > best.value)) {
      best = { value, start: tokens[i].index ?? 0, end: (tokens[j].index ?? 0) + tokens[j][0].length }
    }
    i = j
  }
  if (!best || best.value > 99999999) return null
  return { minor: best.value * 100, rest: (text.slice(0, best.start) + ' ' + text.slice(best.end)).trim() }
}

function extractAmount(text: string): { minor: number | null; rest: string } {
  // prefer a number wearing a currency marker; otherwise take the first number
  const marked = text.match(/(?:₹|\$|€|£|(?:rs|inr|rupees?)\.?\s*)(\d+(?:\.\d{1,2})?)\s*(k)?/i)
  const plain = text.match(/(\d+(?:\.\d{1,2})?)\s*(k)?\s*(?:₹|rs\b|rupees?\b|bucks\b)?/i)
  const m = marked ?? plain
  if (!m || !m[1]) return spokenAmount(text) ?? { minor: null, rest: text }
  const value = parseFloat(m[1]) * (m[2] ? 1000 : 1)
  if (!isFinite(value) || value <= 0 || value > 99999999) return { minor: null, rest: text }
  const rest = (text.slice(0, m.index ?? 0) + ' ' + text.slice((m.index ?? 0) + m[0].length)).trim()
  return { minor: Math.round(value * 100), rest }
}

export function parseSpeech(raw: string, categories: Category[], recent: Txn[]): ParsedSpeech {
  const text = raw.trim().toLowerCase().replace(/,/g, '')
  const { minor, rest } = extractAmount(text)

  const kind: 'out' | 'in' = OUT_CUES.test(text) ? 'out' : IN_CUES.test(text) || FROM_SOMEONE.test(text) ? 'in' : 'out'

  const words = rest.split(/[^a-z0-9₹]+/).filter(Boolean)
  const active = categories.filter((c) => !c.archived)

  // 1) a word that literally is a tag name ("shopping", "rent")
  let categoryId: string | null = active.find((c) => words.includes(c.name.toLowerCase()))?.id ?? null
  // 2) everyday synonyms ("chai" → Food, "uber" → Transport)
  if (!categoryId) {
    outer: for (const [id, syns] of Object.entries(SYNONYMS)) {
      if (!active.some((c) => c.id === id)) continue
      for (const w of words) {
        if (syns.includes(w)) {
          categoryId = id
          break outer
        }
      }
    }
  }
  // 3) part of a tag name ("medic" → Medical), only once nothing surer matched:
  //    "chai at the corner shop" is Food, not Shopping
  if (!categoryId) {
    categoryId = active.find((c) => words.some((w) => w.length >= 4 && c.name.toLowerCase().includes(w)))?.id ?? null
  }

  const noteWords = words.filter((w) => !FILLERS.has(w))
  let note = noteWords.join(' ').slice(0, 60).trim()
  if (note) note = note[0].toUpperCase() + note.slice(1)

  // 4) the user's own history knows best ("zudio" → whatever they tagged it last time)
  if (!categoryId && note) categoryId = guessCategory(note, recent)

  return { amountMinor: minor, kind, note, categoryId }
}
