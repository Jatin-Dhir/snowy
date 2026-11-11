// Release notes for the update screen. A GitHub release body is markdown, and the screen shows a small part of
// it: heading lines become small bold headings, bullet lines (-, *, + or •) a list, and **bold** stays bold.
// Every other piece of syntax goes and its words stay: a link shows its text, `code` reads as plain text, an
// image or an HTML comment disappears. The result is plain data that React renders as elements. The body comes
// from the network, so none of it is ever parsed as HTML. Plain-text notes come through line for line.

/** A stretch of words, bold or not. */
export interface NoteRun {
  text: string
  bold: boolean
}

export type NoteBlock =
  | { kind: 'heading' | 'line'; runs: NoteRun[] }
  | { kind: 'list'; items: NoteRun[][] }
  /** a blank line */
  | { kind: 'gap' }

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const QUOTE = /^ {0,3}>[ \t]?/
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/
const BULLET = /^[ \t]*(?:[-*+][ \t]+|•[ \t]*)(.*)$/
const TASK = /^\[[ xX]\][ \t]+/
// a row of three or more -, * or _ is a divider; = or - under a line makes that line a heading instead
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/
const LINK_DEF = /^ {0,3}\[[^\]]+\]:[ \t]*\S/

export function parseReleaseNotes(body: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let gap = false // a blank line waits to go in before the next block
  let fence = '' // the ``` or ~~~ that opened the code block we're in

  const add = (block: NoteBlock) => {
    const prev = blocks[blocks.length - 1]
    // however the notes are spaced, a heading gets a blank line above it and none below
    if (prev && prev.kind !== 'heading' && (gap || block.kind === 'heading')) blocks.push({ kind: 'gap' })
    gap = false
    blocks.push(block)
  }
  const addItem = (runs: NoteRun[]) => {
    const prev = blocks[blocks.length - 1]
    if (prev?.kind === 'list' && !gap) prev.items.push(runs)
    else add({ kind: 'list', items: [runs] })
  }
  const hasText = (runs: NoteRun[]) => runs.some((r) => r.text.trim() !== '')

  const lines = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/\r\n?|\n/)
  for (let line of lines) {
    if (fence) {
      // inside a code block every line shows as it is
      if (line.trim().startsWith(fence)) fence = ''
      else if (line.trim()) add({ kind: 'line', runs: [{ text: line, bold: false }] })
      else gap = true
      continue
    }
    while (QUOTE.test(line)) line = line.replace(QUOTE, '')
    const open = FENCE.exec(line)
    if (open) {
      fence = open[1]
      continue
    }
    const prev = blocks[blocks.length - 1]
    if (UNDERLINE.test(line) && prev?.kind === 'line' && !gap) {
      blocks.pop()
      add({ kind: 'heading', runs: prev.runs })
      continue
    }
    if (!line.trim() || RULE.test(line) || LINK_DEF.test(line)) {
      gap = true
      continue
    }
    const heading = HEADING.exec(line)
    const bullet = heading ? null : BULLET.exec(line)
    const runs = heading
      ? inline((heading[1] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim())
      : bullet
        ? inline(bullet[1].replace(TASK, ''))
        : inline(line)
    if (!hasText(runs)) gap = true
    else if (heading) add({ kind: 'heading', runs })
    else if (bullet) addItem(runs)
    else add({ kind: 'line', runs })
  }
  return blocks
}

// While a line is read, code and backslash-escaped characters wait behind KEPT plus one index character, so
// nothing in them is taken for markdown, and GONE marks where an image or a tag came out. All of them come from
// Unicode's private-use area, which is cleared out of the line first.
const GONE = ''
const KEPT = ''
const INDEX = 0xe100
const BOLD = /\*\*(?![\s*])(.+?)(?<![\s*])\*\*|(?<![\p{L}\p{N}_])__(?![\s_])(.+?)(?<![\s_])__(?![\p{L}\p{N}_])/gu

/** One line's inline markdown: **bold** becomes a bold run, and every other mark goes while its text stays. */
function inline(line: string): NoteRun[] {
  const kept: string[] = []
  const keep = (text: string) => KEPT + String.fromCharCode(INDEX + kept.push(text) - 1)
  const text = line
    .replace(/[-]/g, '')
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, ticks: string, code: string) =>
      keep(code.replace(/^ (.*) $/, '$1'))
    )
    .replace(/\\([!-\/:-@\[-`{-~])/g, (_, char: string) => keep(char))
    .replace(/\\$/, '')
    // an image goes, a link keeps its words, <https://…> keeps its address, any other tag goes
    .replace(/!\[[^\]]*\](?:\((?:[^()]|\([^()]*\))*\)|\[[^\]]*\])/g, GONE)
    .replace(/\[([^\]]*)\](?:\((?:[^()]|\([^()]*\))*\)|\[[^\]]*\])/g, '$1')
    .replace(/<((?:https?|mailto|ftp):[^\s<>]*|[^\s<>@]+@[^\s<>@]+)>/gi, '$1')
    .replace(/<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/g, GONE)
    // the text stays pre-wrap, so what came out must not leave two spaces, or one at either end
    .replace(/[ \t]*[ \t]*/g, (gone: string, at: number, all: string) =>
      at > 0 && at + gone.length < all.length && /[ \t]/.test(gone) ? ' ' : ''
    )
    .replace(/~~(?!\s)(.+?)(?<!\s)~~/g, '$1')
    // ***both*** is bold, and a single * or _ around words (italics) just goes
    .replace(/\*\*\*(?![\s*])(.+?)(?<![\s*])\*\*\*/g, '**$1**')
    .replace(/(?<![\p{L}\p{N}_])___(?![\s_])(.+?)(?<![\s_])___(?![\p{L}\p{N}_])/gu, '__$1__')
    .replace(/(?<!\*)\*(?![\s*])(.+?)(?<![\s*])\*(?!\*)/g, '$1')
    .replace(/(?<![\p{L}\p{N}_])_(?![\s_])(.+?)(?<![\s_])_(?![\p{L}\p{N}_])/gu, '$1')

  const runs: NoteRun[] = []
  const push = (part: string, bold: boolean) => {
    const words = part.replace(/([-])/g, (_, i: string) => kept[i.charCodeAt(0) - INDEX] ?? '')
    if (!words) return
    const last = runs[runs.length - 1]
    if (last?.bold === bold) last.text += words
    else runs.push({ text: words, bold })
  }
  let at = 0
  for (const m of text.matchAll(BOLD)) {
    const start = m.index ?? 0
    push(text.slice(at, start), false)
    push(m[1] ?? m[2], true)
    at = start + m[0].length
  }
  push(text.slice(at), false)
  return runs
}
