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
const OUT_CUES = /\b(spent|paid|bought|purchase[d]?|gave|sent|order(ed)?)\b/
const FILLERS = new Set([
  'i', 'a', 'an', 'the', 'on', 'for', 'of', 'at', 'in', 'to', 'my', 'me', 'it', 'is', 'was', 'and', 'just',
  'spent', 'paid', 'bought', 'add', 'log', 'note', 'oh', 'god', 'um', 'uh', 'please', 'like', 'some', 'today',
  'rupees', 'rupee', 'rs', 'inr', 'bucks', 'dollars', 'from', 'received', 'got', 'expense'
])

function extractAmount(text: string): { minor: number | null; rest: string } {
  // prefer a number wearing a currency marker; otherwise take the first number
  const marked = text.match(/(?:₹|\$|€|£|(?:rs|inr|rupees?)\.?\s*)(\d+(?:\.\d{1,2})?)\s*(k)?/i)
  const plain = text.match(/(\d+(?:\.\d{1,2})?)\s*(k)?\s*(?:₹|rs\b|rupees?\b|bucks\b)?/i)
  const m = marked ?? plain
  if (!m || !m[1]) return { minor: null, rest: text }
  const value = parseFloat(m[1]) * (m[2] ? 1000 : 1)
  if (!isFinite(value) || value <= 0 || value > 99999999) return { minor: null, rest: text }
  const rest = (text.slice(0, m.index ?? 0) + ' ' + text.slice((m.index ?? 0) + m[0].length)).trim()
  return { minor: Math.round(value * 100), rest }
}

export function parseSpeech(raw: string, categories: Category[], recent: Txn[]): ParsedSpeech {
  const text = raw.trim().toLowerCase().replace(/,/g, '')
  const { minor, rest } = extractAmount(text)

  const kind: 'out' | 'in' = OUT_CUES.test(text) ? 'out' : IN_CUES.test(text) || /\bfrom\s+[a-z]/.test(text) ? 'in' : 'out'

  const words = rest.split(/[^a-z0-9₹]+/).filter(Boolean)
  const active = categories.filter((c) => !c.archived)

  let categoryId: string | null = null
  // 1) a word that literally is a tag name ("shopping", "rent")
  for (const c of active) {
    const name = c.name.toLowerCase()
    if (words.some((w) => w === name || (w.length >= 4 && name.includes(w)))) {
      categoryId = c.id
      break
    }
  }
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

  const noteWords = words.filter((w) => !FILLERS.has(w))
  let note = noteWords.join(' ').slice(0, 60).trim()
  if (note) note = note[0].toUpperCase() + note.slice(1)

  // 3) the user's own history knows best ("zudio" → whatever they tagged it last time)
  if (!categoryId && note) categoryId = guessCategory(note, recent)

  return { amountMinor: minor, kind, note, categoryId }
}
