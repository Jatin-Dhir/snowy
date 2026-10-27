// Turns one spoken sentence into a transaction — fully on-device, no network.
// "250 shopping" · "₹90 chai from cash" · "got 2000 from rahul" · "dhai sau ka
// khana kal" · "paid 1200 electricity bill by card" all work.
import type { Account, Category, Txn } from '../db/db'
import { guessCategory } from './smart'
import { addDaysISO, fromISO, todayISO } from './dates'

export interface ParsedSpeech {
  amountMinor: number | null
  kind: 'out' | 'in'
  note: string
  categoryId: string | null
  /** the day it happened, when one was said: "yesterday", "kal", "on Monday" */
  dateISO?: string
  /** the account it was paid from, when one was named: "cash", "by card", "HDFC" */
  accountId?: string
}

// everyday words → seed tag ids (only applied if that tag still exists)
const SYNONYMS: Record<string, string[]> = {
  food: [
    'food', 'lunch', 'dinner', 'breakfast', 'chai', 'tea', 'coffee', 'snack', 'snacks', 'pizza', 'burger', 'biryani',
    'swiggy', 'zomato', 'restaurant', 'tiffin', 'momos', 'dosa', 'idli', 'thali', 'khana', 'khaana', 'nashta', 'maggi',
    'samosa', 'chaat', 'paratha', 'kfc', 'mcdonalds', 'dominos', 'starbucks', 'cafe', 'canteen', 'mess', 'juice',
    'icecream', 'ice cream', 'sweets', 'mithai', 'bakery', 'cake', 'noodles', 'sandwich', 'pav bhaji', 'vada pav'
  ],
  groceries: [
    'groceries', 'grocery', 'sabzi', 'sabji', 'vegetables', 'veggies', 'fruits', 'milk', 'doodh', 'atta', 'chawal',
    'rice', 'dal', 'daal', 'eggs', 'anda', 'bread', 'zepto', 'blinkit', 'bigbasket', 'big basket', 'instamart',
    'jiomart', 'dmart', 'kirana', 'ration', 'supermarket'
  ],
  shopping: [
    'shopping', 'clothes', 'shoes', 'dress', 'shirt', 'tshirt', 'jeans', 'kurta', 'saree', 'myntra', 'mall', 'zudio',
    'zara', 'decathlon', 'ajio', 'nykaa', 'meesho', 'westside', 'pantaloons', 'gift', 'gifts'
  ],
  online: ['amazon', 'flipkart', 'online'],
  transport: [
    'transport', 'uber', 'ola', 'auto', 'cab', 'taxi', 'bus', 'train', 'metro', 'petrol', 'diesel', 'fuel', 'cng',
    'rapido', 'rickshaw', 'parking', 'toll', 'fastag', 'flight', 'indigo', 'irctc'
  ],
  bills: [
    'bill', 'bills', 'recharge', 'electricity', 'bijli', 'wifi', 'broadband', 'internet', 'mobile', 'postpaid',
    'prepaid', 'gas', 'water', 'jio', 'airtel', 'bsnl', 'dth', 'lpg', 'cylinder', 'maintenance', 'emi', 'insurance'
  ],
  entertainment: [
    'movie', 'movies', 'netflix', 'spotify', 'prime', 'hotstar', 'jiocinema', 'youtube', 'bookmyshow', 'pvr', 'inox',
    'game', 'games', 'concert', 'show', 'tickets'
  ],
  health: [
    'medicine', 'medicines', 'medical', 'dawai', 'dawa', 'davai', 'doctor', 'clinic', 'pharmacy', 'chemist',
    'hospital', 'lab', 'dentist', 'gym', 'protein', 'apollo', 'pharmeasy', 'netmeds'
  ],
  rent: ['rent', 'landlord', 'kiraya'],
  salary: ['salary', 'wage', 'stipend', 'tankhwah'],
  return: ['refund', 'cashback', 'returned', 'return'],
  people: ['mom', 'mummy', 'dad', 'papa', 'bhai', 'didi', 'bro']
}

const INCOME_TAGS = new Set(['return', 'salary'])

// money came in: these win over everything else
const STRONG_IN = /\b(received|receive|credited|refund|refunded|cashback|gave me|sent me|paid me|transferred me|got back|returned|wapas|vapas|mile|mila|mili|aaye|aaya|aayi)\b/
// money went out
const OUT_CUES = /\b(spent|spend|paid|pay|bought|buy|purchase|purchased|gave|sent|order|ordered|kharcha|kharch|kharche|diye|diya|liya|liye|kharida|kharide|bhara|bhare)\b/
// came in, unless something above already said otherwise
const WEAK_IN = /\b(salary|stipend|got)\b/
// "got 500" is money in; "got coffee" is a purchase
const GOT_MONEY = /\bgot\s+(?:back\b|paid\b|₹|rs\b|rupees?\b|\d)/

const FILLERS = new Set([
  'i', 'a', 'an', 'the', 'on', 'for', 'of', 'at', 'in', 'to', 'my', 'me', 'it', 'is', 'was', 'and', 'just', 'add',
  'log', 'note', 'oh', 'god', 'um', 'uh', 'umm', 'please', 'like', 'some', 'expense', 'so', 'okay', 'ok', 'then',
  'spent', 'spend', 'paid', 'pay', 'bought', 'buy', 'received', 'got', 'back', 'from', 'credited', 'gave', 'sent',
  // Hindi glue words, as an English (India) recognizer writes them
  'ka', 'ki', 'ke', 'ko', 'ne', 'par', 'pe', 'mein', 'se', 'aur', 'hai', 'tha', 'thi', 'maine', 'mene', 'mera',
  'meri', 'mere', 'abhi', 'diye', 'diya', 'liye', 'liya', 'mile', 'mila', 'mili', 'kharcha', 'kharch', 'wala',
  'wali', 'wale', 'bas', 'kiya', 'kiye', 'hua', 'hue'
])

const CURRENCY = new Set(['₹', '$', '€', '£', 'rs', 'inr', 'rupees', 'rupee', 'rupaye', 'rupay', 'rupaiya', 'rupiya', 'rupye', 'bucks', 'dollars', 'dollar'])

// a number followed by one of these counts something other than money: "2 kg", "3 months", "5 pm"
const UNITS_AFTER = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'g', 'gm', 'gms', 'gram', 'grams', 'km', 'kms', 'gb', 'mb', 'l', 'litre', 'litres',
  'liter', 'liters', 'ml', 'pcs', 'piece', 'pieces', 'item', 'items', 'people', 'person', 'persons', 'minute',
  'minutes', 'min', 'mins', 'hour', 'hours', 'hr', 'hrs', 'day', 'days', 'din', 'week', 'weeks', 'month', 'months',
  'mahine', 'year', 'years', 'saal', 'am', 'pm', 'baje', 'percent', 'x', 'times', 'baar', 'plate', 'plates', 'cup',
  'cups', 'bottle', 'bottles', 'packet', 'packets', 'dozen', 'ticket', 'tickets'
])

// Numbers said in words: "two fifty", "fifteen hundred", "two thousand five
// hundred", "one lakh" — and in Hindi as written in Latin letters: "do sau",
// "paanch hazaar", "dhai sau" (250), "saade teen sau" (350).
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9,
  das: 10, dus: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18,
  unnis: 19
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  bees: 20, pachchis: 25, pachees: 25, tees: 30, chalis: 40, chaalis: 40, pachaas: 50, pachas: 50, sattar: 70,
  assi: 80, nabbe: 90
}
// "dedh" is one and a half, "dhai" two and a half
const HALVES: Record<string, number> = { dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, arhai: 2.5 }
// "saade teen" is three and a half, "sava do" two and a quarter, "paune paanch" four and three quarters
const MODIFIERS: Record<string, number> = { saade: 0.5, sade: 0.5, sava: 0.25, sawa: 0.25, paune: -0.25 }
const SCALES: Record<string, number> = {
  hundred: 100, hundreds: 100, sau: 100,
  thousand: 1e3, thousands: 1e3, k: 1e3, hazaar: 1e3, hazar: 1e3, hajar: 1e3, hazzar: 1e3,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  ravivar: 0, somvar: 1, mangalvar: 2, budhvar: 3, guruvar: 4, shukravar: 5, shanivar: 6
}

// the words that name how something was paid, mapped to the default accounts' ids
const PAY_ALIASES: Record<string, string> = {
  cash: 'cash', upi: 'upi', gpay: 'upi', 'google pay': 'upi', phonepe: 'upi', 'phone pe': 'upi', paytm: 'upi',
  bhim: 'upi', card: 'card', 'credit card': 'card', 'debit card': 'card'
}
const PAY_CONNECTORS = new Set(['from', 'by', 'via', 'with', 'using', 'through', 'on', 'in', 'se'])
// too often the thing bought ("birthday card", "credit card bill"): these need "by card", "with card"
const NEEDS_CONNECTOR = new Set(['card', 'credit card', 'debit card'])

interface Token {
  text: string
  low: string
  used: boolean
}

const TOKEN = /₹|\$|€|£|\d+(?:[.,]\d+)*|[\p{L}\p{M}]+(?:['’][\p{L}]+)?/gu
const MAX_RUPEES = 99999999

function tokenize(raw: string): Token[] {
  return [...raw.matchAll(TOKEN)].map((m) => ({ text: m[0], low: m[0].toLowerCase(), used: false }))
}

/** The digits of a token as a number: "1,250" and "1,25,000" are grouped, "99.50" has paise. */
function digitValue(t: Token): number | null {
  if (!/^\d/.test(t.low)) return null
  const v = parseFloat(t.low.replace(/,/g, ''))
  return isFinite(v) ? v : null
}

/** Finds `phrase` (one or more lowercase words) among unused tokens; returns its first index. */
function findPhrase(tokens: Token[], phrase: string, from = 0): number {
  const words = phrase.split(' ')
  outer: for (let i = from; i + words.length <= tokens.length; i++) {
    for (let j = 0; j < words.length; j++) {
      if (tokens[i + j].used || tokens[i + j].low !== words[j]) continue outer
    }
    return i
  }
  return -1
}

function consume(tokens: Token[], start: number, count: number) {
  for (let i = start; i < start + count && i < tokens.length; i++) tokens[i].used = true
}

interface Candidate {
  value: number
  start: number
  end: number // exclusive
  marked: boolean
  counted: boolean // "2 kg": a count of something, not a price
}

/** Digit amounts with their scales: "250", "5k", "2 lakh", "1.5 hazaar", "2 thousand 500". */
function digitCandidates(tokens: Token[]): Candidate[] {
  const out: Candidate[] = []
  for (let i = 0; i < tokens.length; i++) {
    const first = digitValue(tokens[i])
    if (first === null) continue
    let total = 0
    let group = first
    let lastScale = Infinity
    let j = i + 1
    // a scale word right after the number ("5 thousand", "5k", "2 sau")
    for (;;) {
      const scale = tokens[j] ? SCALES[tokens[j].low] : undefined
      if (scale !== undefined && scale < lastScale) {
        total += group * scale
        lastScale = scale
        group = 0
        j++
        // and a smaller part after it: "2 thousand 500", "1 lakh 20 thousand"
        const next = tokens[j] ? digitValue(tokens[j]) : null
        if (next !== null && next < scale) {
          group = next
          j++
          continue
        }
        break
      }
      break
    }
    const value = total + group
    const before = tokens[i - 1]?.low
    const after = tokens[j]?.low
    out.push({
      value,
      start: i,
      end: j,
      marked: (before !== undefined && CURRENCY.has(before)) || (after !== undefined && CURRENCY.has(after)),
      counted: after !== undefined && UNITS_AFTER.has(after)
    })
    i = j - 1
  }
  return out
}

const isNumberWord = (w: string | undefined) =>
  w !== undefined && (w in UNITS || w in TENS || w in SCALES || w in HALVES || w in MODIFIERS)

/** The value of a run of number words, English or Hindi. */
function wordsValue(words: string[]): number {
  let total = 0
  let current = 0
  let afterGroup = false
  let bump = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w === 'and' || w === 'a') continue
    if (w in MODIFIERS) {
      bump = MODIFIERS[w]
      continue
    }
    if (w in SCALES) {
      if (SCALES[w] === 100) current = (current || 1) * 100
      else {
        total += (current || 1) * SCALES[w]
        current = 0
      }
      afterGroup = false
      continue
    }
    let group = HALVES[w] ?? TENS[w] ?? UNITS[w]
    const next = UNITS[words[i + 1]]
    if (w in TENS && TENS[w] % 10 === 0 && next > 0 && next < 10 && /^[a-z]+ty$/.test(w)) {
      group += next // "ninety nine"
      i++
    }
    group += bump
    bump = 0
    // two groups back to back is how prices are said: "two fifty" = 250, "four ninety nine" = 499
    current = afterGroup ? current * 100 + group : current + group
    afterGroup = true
  }
  return total + current
}

/** Amounts said in words: "two fifty", "dhai sau". */
function wordCandidates(tokens: Token[]): Candidate[] {
  const out: Candidate[] = []
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].low
    if (!isNumberWord(w) && !(w === 'a' && tokens[i + 1]?.low in SCALES)) continue
    let j = i
    // a run of number words, allowing "and" between them and "a" before "hundred"/"lakh"
    while (
      j + 1 < tokens.length &&
      (isNumberWord(tokens[j + 1].low) ||
        (tokens[j + 1].low === 'and' && isNumberWord(tokens[j + 2]?.low)) ||
        (tokens[j + 1].low === 'a' && tokens[j + 2]?.low in SCALES))
    )
      j++
    const words = tokens.slice(i, j + 1).map((t) => t.low)
    const value = wordsValue(words)
    const before = tokens[i - 1]?.low
    const after = tokens[j + 1]?.low
    const marked = (before !== undefined && CURRENCY.has(before)) || (after !== undefined && CURRENCY.has(after))
    // "one coffee" or "do" alone isn't a price; a scale word, a currency word or ten-plus is
    const real = marked || words.some((x) => x in SCALES) || value >= 10
    if (value > 0 && real) {
      out.push({ value, start: i, end: j + 1, marked, counted: after !== undefined && UNITS_AFTER.has(after) })
    }
    i = j
  }
  return out
}

function pickAmount(tokens: Token[]): number | null {
  // a live caption can mix the two ("2 coffee two fifty"), so both compete
  const candidates = [...digitCandidates(tokens), ...wordCandidates(tokens)]
  const valid = candidates.filter((c) => c.value > 0 && c.value <= MAX_RUPEES)
  // a number wearing a currency marker wins; otherwise the biggest number that isn't
  // counting something ("2 coffees 250", "500 for 2 months")
  const pool = valid.some((c) => c.marked) ? valid.filter((c) => c.marked) : valid.filter((c) => !c.counted)
  if (pool.length === 0) return null
  const best = pool.reduce((a, b) => (b.value > a.value ? b : a))
  consume(tokens, best.start, best.end - best.start)
  // the currency word that came with it isn't part of the note
  if (tokens[best.start - 1] && CURRENCY.has(tokens[best.start - 1].low)) tokens[best.start - 1].used = true
  if (tokens[best.end] && CURRENCY.has(tokens[best.end].low)) tokens[best.end].used = true
  return Math.round(best.value * 100)
}

function pickDate(tokens: Token[], today: string): string | undefined {
  const phrases: [string, number][] = [
    ['day before yesterday', -2],
    ['parso', -2],
    ['parson', -2],
    ['yesterday', -1],
    ['last night', -1],
    ['kal', -1],
    ['today', 0],
    ['this morning', 0],
    ['aaj', 0]
  ]
  for (const [phrase, days] of phrases) {
    const at = findPhrase(tokens, phrase)
    if (at >= 0) {
      consume(tokens, at, phrase.split(' ').length)
      return days === 0 ? undefined : addDaysISO(today, days)
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const day = WEEKDAYS[tokens[i].low]
    if (day === undefined || tokens[i].used) continue
    const last = tokens[i - 1]?.low === 'last'
    let back = (fromISO(today).getDay() - day + 7) % 7
    if (back === 0 && last) back = 7
    tokens[i].used = true
    if (tokens[i - 1] && ['on', 'last'].includes(tokens[i - 1].low)) tokens[i - 1].used = true
    return back === 0 ? undefined : addDaysISO(today, -back)
  }
  return undefined
}

function pickAccount(tokens: Token[], accounts: Account[]): string | undefined {
  const active = accounts.filter((a) => !a.archived)
  if (active.length === 0) return undefined
  // the person's own account names first ("HDFC", "Paytm wallet"), longest first
  const named: [string, string][] = active
    .map((a) => [a.name.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim(), a.id] as [string, string])
    .filter(([n]) => n.length > 0)
  const aliases: [string, string][] = Object.entries(PAY_ALIASES)
    .map(([word, id]) => {
      const byName = active.find((a) => a.name.toLowerCase() === word)
      const byId = active.find((a) => a.id === id)
      return [word, (byName ?? byId)?.id ?? ''] as [string, string]
    })
    .filter(([, id]) => id)
  const all = [...named, ...aliases].sort((a, b) => b[0].split(' ').length - a[0].split(' ').length)
  for (const [phrase, id] of all) {
    let at = findPhrase(tokens, phrase)
    while (at >= 0) {
      const before = tokens[at - 1]?.low
      const connected = before !== undefined && PAY_CONNECTORS.has(before)
      if (connected || !NEEDS_CONNECTOR.has(phrase)) {
        consume(tokens, at, phrase.split(' ').length)
        if (connected) tokens[at - 1].used = true
        return id
      }
      at = findPhrase(tokens, phrase, at + 1)
    }
  }
  return undefined
}

function pickKind(low: string, payWords: string[]): 'out' | 'in' {
  if (STRONG_IN.test(low)) return 'in'
  if (OUT_CUES.test(low)) return 'out'
  if (/\bgot\b/.test(low) && !GOT_MONEY.test(low)) return 'out'
  if (WEAK_IN.test(low)) return 'in'
  // "from rahul" means money came in; "from cash" or "from my card" only says how it was paid
  const fromSomeone = new RegExp(
    `\\bfrom\\s+(?!(?:my\\s+)?(?:${['cash', 'upi', 'card', 'credit', 'debit', 'wallet', 'bank', 'account', 'gpay', 'phonepe', 'paytm', ...payWords].join('|')})\\b)[\\p{L}]`,
    'u'
  )
  return fromSomeone.test(low) ? 'in' : 'out'
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseSpeech(
  raw: string,
  categories: Category[],
  recent: Txn[],
  accounts: Account[] = [],
  today: string = todayISO()
): ParsedSpeech {
  const tokens = tokenize(raw.trim())
  const low = tokens.map((t) => t.low).join(' ')
  const payWords = accounts.filter((a) => !a.archived).map((a) => escapeRe(a.name.toLowerCase().split(/\s+/)[0] ?? '')).filter(Boolean)
  const kind = pickKind(low, payWords)

  const dateISO = pickDate(tokens, today)
  const accountId = pickAccount(tokens, accounts)
  const amountMinor = pickAmount(tokens)

  const active = categories.filter((c) => !c.archived)
  const free = () => tokens.filter((t) => !t.used)
  const lowFree = () => ' ' + free().map((t) => t.low).join(' ') + ' '

  // 1) a word that literally is a tag name ("shopping", "rent", "bills & recharge"): it says the tag, not a note
  let categoryId: string | null = null
  for (const c of active) {
    const name = c.name.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
    if (!name) continue
    const at = findPhrase(tokens, name)
    if (at >= 0) {
      categoryId = c.id
      consume(tokens, at, name.split(' ').length)
      break
    }
  }
  // 2) everyday synonyms ("chai" → Food, "uber" → Transport); the word stays in the note.
  //    Money in looks at the income tags first: a refund from Amazon is a Return, not Online
  if (!categoryId) {
    const text = lowFree()
    const groups = Object.entries(SYNONYMS)
    if (kind === 'in') groups.sort(([a], [b]) => Number(INCOME_TAGS.has(b)) - Number(INCOME_TAGS.has(a)))
    outer: for (const [id, syns] of groups) {
      if (!active.some((c) => c.id === id)) continue
      for (const s of syns) {
        // plurals too: "coffees", "samosas"
        if (text.includes(` ${s} `) || text.includes(` ${s}s `) || text.includes(` ${s}es `)) {
          categoryId = id
          break outer
        }
      }
    }
  }
  // 3) part of a tag name ("medic" → Medical), only once nothing surer matched:
  //    "chai at the corner shop" is Food, not Shopping
  if (!categoryId) {
    const words = free().map((t) => t.low)
    categoryId =
      active.find((c) => words.some((w) => w.length >= 4 && !FILLERS.has(w) && c.name.toLowerCase().includes(w)))?.id ?? null
  }

  // the note keeps the recognizer's capitals ("Rahul", "Zudio") and drops the glue words
  const noteWords = free()
    .filter((t) => !FILLERS.has(t.low) && !CURRENCY.has(t.low))
    .map((t) => t.text)
  let note = noteWords.join(' ').slice(0, 60).trim()
  if (note) note = note[0].toUpperCase() + note.slice(1)

  // 4) the person's own history knows best ("zudio" → whatever they tagged it last time)
  if (!categoryId && note) categoryId = guessCategory(note, recent)
  // 5) money in from someone, with nothing more specific said, is a payment
  if (!categoryId && kind === 'in' && active.some((c) => c.id === 'payment')) categoryId = 'payment'

  const parsed: ParsedSpeech = { amountMinor, kind, note, categoryId }
  if (dateISO) parsed.dateISO = dateISO
  if (accountId) parsed.accountId = accountId
  return parsed
}

/** How much of a transaction a parse found — to choose between the recognizer's alternates. */
export function parseScore(p: ParsedSpeech): number {
  return (p.amountMinor ? 4 : 0) + (p.categoryId ? 2 : 0) + (p.note ? 0.5 : 0)
}
