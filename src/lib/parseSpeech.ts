// Turns one spoken sentence into a transaction — fully on-device, no network.
// "250 shopping" · "₹90 chai from cash" · "got 2000 from rahul" · "dhai sau ka khana kal" ·
// "paid 1200 electricity bill by card" all work, and so do the ways a recognizer writes speech down:
// "2 50 lunch" (two fifty), "250 launch", "teen so pachas", "G Pay", Devanagari.
// scripts/voice-phrases/run.mjs measures it against a few hundred phrases: run it after any change here.
import type { Account, Category, Trip, Txn } from '../db/db'
import { guessCategory } from './smart'
import { addDaysISO, fromISO, todayISO } from './dates'

export interface ParsedSpeech {
  amountMinor: number | null
  kind: 'out' | 'in'
  note: string
  categoryId: string | null
  /** the day it happened, when one was said: "yesterday", "kal", "on Monday", "on the 3rd" */
  dateISO?: string
  /** the account it was paid from, when one was named: "cash", "by card", "HDFC" */
  accountId?: string
  /** on a trip, who put the money down, when it was someone else: "Rahul paid 800 cab" */
  paidBy?: string
}

/* ------------------------------------------------------------------ tags */

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
  salary: ['salary', 'wage', 'stipend', 'tankhwah', 'bonus', 'incentive'],
  return: ['refund', 'cashback', 'returned', 'return'],
  people: [
    'mom', 'mummy', 'mum', 'mother', 'maa', 'dad', 'daddy', 'papa', 'father', 'bhai', 'bhaiya', 'didi', 'bro', 'brother',
    'sister', 'uncle', 'aunty', 'nana', 'nani', 'dada', 'dadi', 'chacha', 'chachi', 'mama', 'mami'
  ]
}

// a brand inside a platform says more than the platform: "Swiggy Instamart" is groceries, "Amazon Prime" a show
const PLATFORMS = new Set(['swiggy', 'zomato', 'amazon', 'flipkart', 'jio', 'airtel', 'uber', 'ola', 'paytm'])
const BRANDS = new Set([
  'kfc', 'mcdonalds', 'dominos', 'starbucks', 'zepto', 'blinkit', 'bigbasket', 'big basket', 'instamart', 'jiomart',
  'dmart', 'myntra', 'zudio', 'zara', 'decathlon', 'ajio', 'nykaa', 'meesho', 'westside', 'pantaloons', 'rapido',
  'indigo', 'irctc', 'fastag', 'bsnl', 'netflix', 'spotify', 'prime', 'hotstar', 'jiocinema', 'youtube', 'bookmyshow',
  'pvr', 'inox', 'apollo', 'pharmeasy', 'netmeds'
])

// tags for money that came in: a spend never gets one, whatever its words ("maid salary", "return cab")
const INCOME_TAGS = new Set(['return', 'salary', 'payment'])
// seed tags whose names are also plain words ("lunch for 3 people", "return cab", "paid online"): said like that,
// they name the tag only when nothing else in the sentence does. A renamed tag is the person's own word and counts.
const PLAIN_NAMES: Record<string, string> = {
  people: 'people', other: 'other', return: 'return', payment: 'payment', online: 'online', savings: 'savings'
}

// what a recognizer writes for a word it misheard. Google's English (India) recognizer, fed synthetic voices,
// wrote "dinner" as "Dinar" in 4 of 6 tries (scripts/voice-phrases/cases.mjs, group 14)
const MISHEARD: Record<string, string> = { launch: 'lunch', dinar: 'dinner' }

/* ------------------------------------------------------------------ money in or out */

// money came in: these win over most else
const STRONG_IN = /\b(received|receive|recieved|credited|refund|refunded|cashback|gave me|sent me|paid me|transferred me|got back|returned|wapas|vapas|mile|mila|mili|sold|becha|beche|bechi)\b/
// money went out
const OUT_CUES = /\b(spent|spend|paid|pay|bought|buy|purchase|purchased|gave|sent|order|ordered|kharcha|kharch|kharche|diye|diya|liya|liye|kharida|kharide|bhara|bhare)\b/
// pay, unless it's someone else's: "salary 50000" came in, "maid salary 3000" went out
const PAY_IN = new Set(['salary', 'stipend', 'bonus', 'incentive', 'pension', 'freelance', 'commission', 'dividend', 'tankhwah'])
const PAYEES = new Set([
  'maid', 'bai', 'kaamwali', 'kamwali', 'driver', 'cook', 'cleaner', 'servant', 'staff', 'helper', 'nanny', 'guard',
  'watchman', 'gardener', 'mali', 'dhobi', 'plumber', 'electrician', 'carpenter', 'tutor', 'employee', 'employees',
  'worker', 'workers', 'labour', 'broker', 'agent'
])
// "came": money did ("500 aaye"), or a bill or a delivery did ("bill aaya", "khana aaya")
const CAME = new Set(['aaya', 'aaye', 'aayi', 'aai', 'aya', 'ayi'])
// someone else handing money over is money in: "Rahul gave 500", "Mom sent 5000", "papa ne 2000 bheje"
const GAVE = new Set(['gave', 'sent', 'transferred'])
const GAVE_HI = new Set(['diye', 'diya', 'di', 'de', 'dedi', 'dediye', 'bheje', 'bheja', 'bheji', 'bhej', 'transfer', 'lautaye', 'lautaya', 'lautai'])
// handing it to someone is money out: "returned 500 to Rahul", "Rahul ko 500 wapas diye"
const HANDED = new Set(['returned', 'return', 'gave', 'give', 'sent', 'send', 'paid', 'pay', 'transferred', 'transfer', 'lent', 'lend', 'refunded'])
// the speaker, not someone else
const SELF = new Set(['i', 'we', 'me', 'my', 'myself', 'us', 'maine', 'mene', 'mai', 'main', 'hum', 'humne', 'hamne', 'mujhe', 'mujhko', 'humko', 'hamko', 'you', 'u'])
// "from mom" is money in even beside a spend's word ("lunch money from papa"); other names only when no spend is named
const KIN = new Set([
  ...SYNONYMS.people, 'friend', 'dost', 'wife', 'husband', 'beta', 'beti', 'son', 'daughter', 'boss', 'colleague', 'roommate', 'tenant'
])
// how it was paid, after "from": "from cash", "from my card" say nothing about money coming in
const PAY_WORDS = ['cash', 'upi', 'card', 'credit', 'debit', 'wallet', 'bank', 'account', 'gpay', 'phonepe', 'paytm']

const FILLERS = new Set([
  'i', 'a', 'an', 'the', 'on', 'for', 'of', 'at', 'in', 'to', 'my', 'me', 'it', 'is', 'was', 'and', 'just', 'add',
  'log', 'note', 'oh', 'god', 'um', 'uh', 'umm', 'please', 'like', 'some', 'expense', 'so', 'okay', 'ok', 'then',
  'spent', 'spend', 'paid', 'pay', 'bought', 'buy', 'received', 'receive', 'got', 'back', 'from', 'credited', 'gave', 'sent',
  // Hindi glue words, as an English (India) recognizer writes them
  'ka', 'ki', 'ke', 'ko', 'ne', 'par', 'pe', 'mein', 'se', 'aur', 'hai', 'tha', 'thi', 'maine', 'mene', 'mera',
  'meri', 'mere', 'abhi', 'diye', 'diya', 'liye', 'liya', 'mile', 'mila', 'mili', 'kharcha', 'kharch', 'wala',
  'wali', 'wale', 'bas', 'kiya', 'kiye', 'hua', 'hue', 'bheje', 'bheja', 'bheji', 'bhej', 'aaya', 'aaye', 'aayi',
  'aai', 'aa', 'gaya', 'gayi', 'gaye', 'kar', 'karke', 'de', 'mujhe', 'mujhko', 'humne', 'hamne', 'bhara', 'bhare',
  'dalwaya', 'karwaya', 'karaya'
])

/* ------------------------------------------------------------------ numbers */

const CURRENCY = new Set([
  '₹', '$', '€', '£', 'rs', 'inr', 'rupees', 'rupee', 'rupaye', 'rupay', 'rupaiya', 'rupaiye', 'rupiya', 'rupiye', 'rupye',
  'bucks', 'dollars', 'dollar'
])

// a number followed by one of these counts something other than money: "2 kg", "3 months", "5 pm"
const UNITS_AFTER = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'g', 'gm', 'gms', 'gram', 'grams', 'km', 'kms', 'gb', 'mb', 'l', 'litre', 'litres',
  'liter', 'liters', 'ml', 'pcs', 'piece', 'pieces', 'item', 'items', 'people', 'person', 'persons', 'minute',
  'minutes', 'min', 'mins', 'hour', 'hours', 'hr', 'hrs', 'day', 'days', 'din', 'week', 'weeks', 'month', 'months',
  'mahine', 'year', 'years', 'saal', 'am', 'pm', 'baje', 'percent', 'x', 'times', 'baar', 'plate', 'plates', 'cup',
  'cups', 'bottle', 'bottles', 'packet', 'packets', 'dozen', 'ticket', 'tickets'
])
// a number after one of these names a place, not a price: "sector 62", "flat 2304", "route 522"
const LABELS = new Set(['sector', 'block', 'flat', 'gate', 'route', 'platform', 'plot', 'room', 'seat', 'tower', 'number'])
// the number right after one of these is what it cost: "paid 50 for 100 photocopies"
const PRICED = new Set(['paid', 'pay', 'paying', 'spent', 'spend', 'cost', 'costs', 'costed', 'kharcha', 'kharch', 'kharche'])
// "at 9 30", "by 6:15": a time of day
const AT_TIME = new Set(['at', 'by', 'around', 'till', 'until', 'before', 'after', 'baje'])

// Numbers said in words: "two fifty", "fifteen hundred", "two thousand five hundred", "one lakh" — and in Hindi
// as written in Latin letters: "do sau", "paanch hazaar", "dhai sau" (250), "saade teen sau" (350), "pachpan" (55).
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, cheh: 6, saat: 7, aath: 8, nau: 9,
  das: 10, dus: 10, gyarah: 11, gyaarah: 11, barah: 12, baarah: 12, terah: 13, chaudah: 14, chaudha: 14, pandrah: 15,
  pandra: 15, solah: 16, sola: 16, satrah: 17, satra: 17, atharah: 18, athara: 18, unnis: 19, unnees: 19
}
// English tens, which take a unit after them: "ninety nine"
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
}
// Hindi has a word for every number to a hundred, in a few Latin spellings each
const HINDI: Record<string, number> = {}
const HINDI_SPELLINGS: [number, string][] = [
  [20, 'bees'], [21, 'ikkis ikkees ekkis'], [22, 'bais baees baais baaees'], [23, 'teis teyis teyees'],
  [24, 'chaubis chaubees chobis chaubbis'], [25, 'pachis pachees pachchis pachchees pacchis'],
  [26, 'chhabbis chabbis chhabbees chabbees'], [27, 'sattais sattaees sataees sattaais'],
  [28, 'atthais athais atthaees athaees'], [29, 'untis untees unatis'], [30, 'tees'],
  [31, 'iktis ikattis iktees ikatees'], [32, 'battis battees batees'], [33, 'tetis taintis taintees tentees tetees'],
  [34, 'chautis chauntis chontees chautees chauntees'], [35, 'paintis paintees pentees pentis'],
  [36, 'chhattis chattis chhattees chattees'], [37, 'saintis saintees sentees sentis'],
  [38, 'adtis artis adtees artees'], [39, 'untalis untalees unchalis unchalees'],
  [40, 'chalis chaalis chalees chaalees'], [41, 'iktalis iktalees iktaalis'], [42, 'bayalis bayalees biyalis byalis'],
  [43, 'taintalis tetalis taintalees tentalis'], [44, 'chavalis chauvalis chawalis chauwalis chawalees chavalees'],
  [45, 'paintalis paintalees pentalis pentalees'], [46, 'chhiyalis chiyalis chhiyalees chiyalees'],
  [47, 'saintalis saintalees sentalis'], [48, 'adtalis artalis adtalees artalees'], [49, 'unchas unchaas unanchas'],
  [50, 'pachas pachaas'], [51, 'ikyavan ikyawan ekyavan ikkyavan ikyaavan'], [52, 'bavan baavan bawan'],
  [53, 'tirepan tirpan trepan tirapan'], [54, 'chauvan chauwan chowan chouvan'], [55, 'pachpan pachapan'],
  [56, 'chhappan chappan'], [57, 'sattavan sattawan sataavan'], [58, 'atthavan athavan atthawan athawan'],
  [59, 'unsath unsaath'], [61, 'iksath iksaath eksath'], [62, 'basath baasath'], [63, 'tirsath tirsaath tresath'],
  [64, 'chausath chaunsath chausaath chonsath'], [65, 'painsath painsaath pensath'],
  [66, 'chhiyasath chiyasath chhiyaasath'], [67, 'sarsath sadsath sadsaath sarsaath'],
  [68, 'adsath arsath adsaath arsaath'], [69, 'unhattar unhatar'], [70, 'sattar sattaar'],
  [71, 'ikhattar ikahattar ikattar'], [72, 'bahattar bahatar'], [73, 'tihattar tihatar'], [74, 'chauhattar chauhatar'],
  [75, 'pachhattar pachattar pachhatar pachatar'], [76, 'chhihattar chihattar'], [77, 'satattar sathattar satahattar'],
  [78, 'athattar atthattar'], [79, 'unasi unaasi unyasi'], [80, 'assi assee'], [81, 'ikyasi ikkyasi ekyasi'],
  [82, 'bayasi biyasi'], [83, 'tirasi tiraasi'], [84, 'chaurasi chauraasi'], [85, 'pachasi pachaasi'],
  [86, 'chhiyasi chiyasi'], [87, 'sattasi sattaasi'], [88, 'athasi atthasi athaasi'], [89, 'navasi nawasi'],
  [90, 'nabbe nabbey'], [91, 'ikyanve ikyaanve'], [92, 'banve baanve'], [93, 'tiranve tiraanve'],
  [94, 'chauranve chauraanve'], [95, 'pachanve pachaanve panchanve'], [96, 'chhiyanve chiyanve'],
  [97, 'sattanve sattaanve'], [98, 'atthanve athanve atthaanve'], [99, 'ninyanve ninyaanve ninanve']
]
for (const [n, words] of HINDI_SPELLINGS) for (const w of words.split(' ')) HINDI[w] = n
// "saath" is sixty, and also "with": "Rahul ke saath" is with Rahul
const SIXTY = new Set(['saath', 'sath'])
// "dedh" is one and a half, "dhai" two and a half
const HALVES: Record<string, number> = { dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, arhai: 2.5 }
// "saade teen" is three and a half, "sava do" two and a quarter, "paune paanch" four and three quarters
// (speech recognizers spell "saade" with or without the h)
const MODIFIERS: Record<string, number> = {
  saade: 0.5, sade: 0.5, saadhe: 0.5, sadhe: 0.5, sava: 0.25, sawa: 0.25, paune: -0.25
}
const SCALES: Record<string, number> = {
  hundred: 100, hundreds: 100, sau: 100,
  thousand: 1e3, thousands: 1e3, hazaar: 1e3, hazar: 1e3, hajar: 1e3, hazzar: 1e3,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7
}
// short forms count only right after a number: "5k", "2 cr" — not "R K Stores" or "CR Park"
const SHORT_SCALES: Record<string, number> = { k: 1e3, cr: 1e7 }
// a scale written in digits, read as one only right after a half: "one and half 1000"
const WRITTEN_SCALES = new Set([100, 1e3, 1e5, 1e7])

const isNumberWord = (w: string | undefined) =>
  w !== undefined && (w in UNITS || w in TENS || w in HINDI || w in HALVES || w in MODIFIERS || w in SCALES || SIXTY.has(w))

/* ------------------------------------------------------------------ dates */

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  ravivar: 0, somvar: 1, mangalvar: 2, budhvar: 3, guruvar: 4, shukravar: 5, shanivar: 6
}
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7,
  jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12
}
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30
}
// "kal raat", "yesterday night": the time of day adds nothing to the date
const TIME_OF_DAY = new Set(['night', 'morning', 'evening', 'afternoon', 'raat', 'subah', 'shaam', 'dopahar'])
const AGO = new Set(['ago', 'back', 'before', 'pehle', 'pahle', 'pehele'])
const TARIKH = new Set(['tarikh', 'tareekh', 'taarikh', 'tarik'])
const DATE_WORDS = new Set(['yesterday', 'today', 'tonight', 'tomorrow', 'kal', 'aaj', 'parso', 'parson', ...Object.keys(WEEKDAYS)])

/* ------------------------------------------------------------------ accounts */

// the words that name how something was paid, mapped to the default accounts' ids
const PAY_ALIASES: Record<string, string> = {
  cash: 'cash', upi: 'upi', gpay: 'upi', 'google pay': 'upi', phonepe: 'upi', 'phone pe': 'upi', 'phone pay': 'upi',
  phonepay: 'upi', paytm: 'upi', bhim: 'upi', card: 'card', 'credit card': 'card', 'debit card': 'card'
}
const PAY_CONNECTORS = new Set(['from', 'by', 'via', 'with', 'using', 'through', 'on', 'in', 'se'])
// Hindi says it after: "card se", "cash mein", "UPI pe"
const PAY_AFTER = new Set(['se', 'pe', 'par', 'mein', 'me'])
// "from my card", "with the debit card"
const OWNERS = new Set(['my', 'the', 'a', 'mere', 'meri', 'mera', 'apne', 'apni', 'apna'])
// too often the thing bought ("birthday card", "credit card bill"): these need "by card", "card se"
const NEEDS_CONNECTOR = new Set(['card', 'credit card'])

/* ------------------------------------------------------------------ Devanagari */

// An English (India) recognizer can answer in Devanagari: the words that matter are read as their Latin spelling,
// so everything above applies, while the note keeps what was said. Keys are without nukta, and with anusvara for
// chandrabindu (see devanagari()).
const DEVANAGARI: Record<string, string> = {
  // numbers
  'एक': 'ek', 'दो': 'do', 'तीन': 'teen', 'चार': 'chaar', 'पांच': 'paanch', 'छह': 'chhah', 'छः': 'chhah', 'छे': 'chhe',
  'सात': 'saat', 'आठ': 'aath', 'नौ': 'nau', 'दस': 'das', 'ग्यारह': 'gyarah', 'बारह': 'barah', 'तेरह': 'terah',
  'चौदह': 'chaudah', 'पंद्रह': 'pandrah', 'पन्द्रह': 'pandrah', 'सोलह': 'solah', 'सत्रह': 'satrah', 'अठारह': 'atharah',
  'उन्नीस': 'unnis', 'बीस': 'bees', 'इक्कीस': 'ikkis', 'बाईस': 'bais', 'तेईस': 'teis', 'चौबीस': 'chaubis',
  'पच्चीस': 'pachchis', 'छब्बीस': 'chhabbis', 'सत्ताईस': 'sattais', 'अट्ठाईस': 'atthais', 'उनतीस': 'untis', 'तीस': 'tees',
  'इकतीस': 'iktis', 'बत्तीस': 'battis', 'तैंतीस': 'taintis', 'चौंतीस': 'chautis', 'पैंतीस': 'paintis', 'छत्तीस': 'chhattis',
  'सैंतीस': 'saintis', 'अडतीस': 'adtis', 'उनतालीस': 'untalis', 'चालीस': 'chalis', 'इकतालीस': 'iktalis',
  'बयालीस': 'bayalis', 'तैंतालीस': 'taintalis', 'चवालीस': 'chavalis', 'पैंतालीस': 'paintalis', 'छियालीस': 'chhiyalis',
  'सैंतालीस': 'saintalis', 'अडतालीस': 'adtalis', 'उनचास': 'unchas', 'पचास': 'pachas', 'इक्यावन': 'ikyavan',
  'बावन': 'bavan', 'तिरेपन': 'tirepan', 'चौवन': 'chauvan', 'पचपन': 'pachpan', 'छप्पन': 'chhappan', 'सत्तावन': 'sattavan',
  'अट्ठावन': 'atthavan', 'उनसठ': 'unsath', 'साठ': 'saath', 'इकसठ': 'iksath', 'बासठ': 'basath', 'तिरसठ': 'tirsath',
  'चौंसठ': 'chausath', 'पैंसठ': 'painsath', 'छियासठ': 'chhiyasath', 'सडसठ': 'sadsath', 'अडसठ': 'adsath',
  'उनहत्तर': 'unhattar', 'सत्तर': 'sattar', 'इकहत्तर': 'ikhattar', 'बहत्तर': 'bahattar', 'तिहत्तर': 'tihattar',
  'चौहत्तर': 'chauhattar', 'पचहत्तर': 'pachhattar', 'छिहत्तर': 'chhihattar', 'सतहत्तर': 'satattar', 'अठहत्तर': 'athattar',
  'उन्यासी': 'unasi', 'उनासी': 'unasi', 'अस्सी': 'assi', 'इक्यासी': 'ikyasi', 'बयासी': 'bayasi', 'तिरासी': 'tirasi',
  'चौरासी': 'chaurasi', 'पचासी': 'pachasi', 'छियासी': 'chhiyasi', 'सत्तासी': 'sattasi', 'अट्ठासी': 'athasi',
  'नवासी': 'navasi', 'नब्बे': 'nabbe', 'इक्यानवे': 'ikyanve', 'बानवे': 'banve', 'तिरानवे': 'tiranve',
  'चौरानवे': 'chauranve', 'पचानवे': 'pachanve', 'पंचानवे': 'pachanve', 'छियानवे': 'chhiyanve', 'सत्तानवे': 'sattanve',
  'अट्ठानवे': 'atthanve', 'निन्यानवे': 'ninyanve', 'सौ': 'sau', 'हजार': 'hazaar', 'लाख': 'lakh', 'करोड': 'crore',
  'डेढ': 'dedh', 'ढाई': 'dhai', 'साढे': 'saade', 'सवा': 'sava', 'पौने': 'paune',
  'रुपये': 'rupaye', 'रुपए': 'rupaye', 'रुपया': 'rupaye', 'रुपयों': 'rupaye', 'रु': 'rs',
  // glue, and "with" (साथ), which must not read as sixty (साठ)
  'का': 'ka', 'की': 'ki', 'के': 'ke', 'को': 'ko', 'ने': 'ne', 'से': 'se', 'में': 'mein', 'मे': 'mein', 'पर': 'par',
  'पे': 'pe', 'और': 'aur', 'है': 'hai', 'था': 'tha', 'थी': 'thi', 'मैंने': 'maine', 'मैने': 'maine', 'मेरा': 'mera',
  'मेरी': 'meri', 'मेरे': 'mere', 'अभी': 'abhi', 'वाला': 'wala', 'वाली': 'wali', 'वाले': 'wale', 'हुआ': 'hua',
  'हुए': 'hue', 'किया': 'kiya', 'किए': 'kiye', 'किये': 'kiye', 'कर': 'kar', 'करके': 'karke', 'मुझे': 'mujhe',
  'मैं': 'main', 'हम': 'hum', 'साथ': 'with',
  // money in or out
  'दिए': 'diye', 'दिये': 'diye', 'दिया': 'diya', 'दी': 'di', 'दे': 'de', 'लिए': 'liye', 'लिये': 'liye', 'लिया': 'liya',
  'मिले': 'mile', 'मिला': 'mila', 'मिली': 'mili', 'आए': 'aaye', 'आये': 'aaye', 'आया': 'aaya', 'आई': 'aayi',
  'भेजे': 'bheje', 'भेजा': 'bheja', 'भेजी': 'bheji', 'वापस': 'wapas', 'खर्च': 'kharch', 'खर्चा': 'kharcha',
  'खर्चे': 'kharche', 'भरे': 'bhare', 'भरा': 'bhara', 'खरीदा': 'kharida', 'खरीदे': 'kharide', 'बेचा': 'becha',
  'बेची': 'bechi', 'बेचे': 'beche', 'रिफंड': 'refund', 'कैशबैक': 'cashback', 'सैलरी': 'salary', 'वेतन': 'salary',
  'तनख्वाह': 'tankhwah', 'बोनस': 'bonus', 'पेमेंट': 'payment',
  // how it was paid
  'कार्ड': 'card', 'कैश': 'cash', 'नकद': 'cash', 'यूपीआई': 'upi', 'पेटीएम': 'paytm', 'फोन': 'phone', 'गूगल': 'google',
  'जीपे': 'gpay', 'क्रेडिट': 'credit', 'डेबिट': 'debit',
  // days
  'कल': 'kal', 'आज': 'aaj', 'परसों': 'parso', 'सोमवार': 'somvar', 'मंगलवार': 'mangalvar', 'बुधवार': 'budhvar',
  'गुरुवार': 'guruvar', 'शुक्रवार': 'shukravar', 'शनिवार': 'shanivar', 'रविवार': 'ravivar', 'दिन': 'din',
  'पहले': 'pehle', 'रात': 'raat', 'सुबह': 'subah', 'शाम': 'shaam', 'तारीख': 'tarikh',
  // what it was for
  'खाना': 'khana', 'नाश्ता': 'nashta', 'चाय': 'chai', 'कॉफी': 'coffee', 'दूध': 'doodh', 'सब्जी': 'sabzi',
  'सब्जियां': 'sabzi', 'फल': 'fruits', 'राशन': 'ration', 'किराना': 'kirana', 'आटा': 'atta', 'चावल': 'chawal',
  'दाल': 'dal', 'अंडे': 'anda', 'अंडा': 'anda', 'किराया': 'kiraya', 'बिजली': 'bijli', 'बिल': 'bill',
  'रिचार्ज': 'recharge', 'पानी': 'water', 'गैस': 'gas', 'सिलेंडर': 'cylinder', 'पेट्रोल': 'petrol', 'डीजल': 'diesel',
  'ऑटो': 'auto', 'टैक्सी': 'taxi', 'कैब': 'cab', 'मेट्रो': 'metro', 'ट्रेन': 'train', 'बस': 'bus', 'दवाई': 'dawai',
  'दवा': 'dawa', 'दवाइयां': 'dawai', 'डॉक्टर': 'doctor', 'डाक्टर': 'doctor', 'अस्पताल': 'hospital', 'मूवी': 'movie',
  'फिल्म': 'movie', 'कपडे': 'clothes', 'जूते': 'shoes', 'शॉपिंग': 'shopping', 'गिफ्ट': 'gift', 'तोहफा': 'gift',
  'मोबाइल': 'mobile', 'इंटरनेट': 'internet', 'बीमा': 'insurance', 'मम्मी': 'mummy', 'मां': 'maa', 'पापा': 'papa',
  'भाई': 'bhai', 'दीदी': 'didi',
  // English words as Google's Hindi recognizer spells them ("250 लंच", "1500 ग्रोसरीज", "2000 फ्रॉम राहुल")
  'लंच': 'lunch', 'लॉन्च': 'launch', 'डिनर': 'dinner', 'ब्रेकफास्ट': 'breakfast', 'स्नैक्स': 'snacks', 'पिज्जा': 'pizza',
  'बर्गर': 'burger', 'बिरयानी': 'biryani', 'ग्रोसरी': 'grocery', 'ग्रॉसरी': 'grocery', 'ग्रोसरीज': 'groceries',
  'स्विगी': 'swiggy', 'जोमैटो': 'zomato', 'उबर': 'uber', 'ओला': 'ola', 'अमेजन': 'amazon', 'अमेजॉन': 'amazon',
  'फ्लिपकार्ट': 'flipkart', 'ब्लिंकिट': 'blinkit', 'जेप्टो': 'zepto', 'नेटफ्लिक्स': 'netflix', 'जियो': 'jio',
  'एयरटेल': 'airtel', 'रेंट': 'rent', 'पार्किंग': 'parking', 'इलेक्ट्रिसिटी': 'electricity', 'मेडिसिन': 'medicine',
  'फोनपे': 'phonepe', 'फ्रॉम': 'from', 'गॉट': 'got', 'रिसीव्ड': 'received'
}
/** Devanagari spelled one way: precomposed nukta letters taken apart and the nukta dropped, chandrabindu as anusvara. */
function devanagari(s: string): string {
  return s.normalize('NFD').replace(/\u093C/g, '').replace(/\u0901/g, '\u0902').replace(/[\u200C\u200D]/g, '').normalize('NFC')
}

/* ------------------------------------------------------------------ tokens */

interface Token {
  /** as heard: the recognizer's capitals, and Devanagari, stay in the note */
  text: string
  /** lowercase; Devanagari as its Latin spelling; a misheard word put right */
  low: string
  /** `low` without apostrophes, for names: "domino's" → "dominos" */
  key: string
  used: boolean
  /** "3rd", "25th" */
  ord?: number
  /** "2:50", how a recognizer writes "two fifty" */
  clock?: boolean
  /** part of a name said in pieces ("Book My Show", "A K Stores"): kept in the note even if it's a glue word */
  whole?: boolean
}

const TOKEN = /₹|\$|€|£|\d{1,2}:\d{2}(?!\d)|\d{1,2}(?:st|nd|rd|th)(?![\p{L}\p{N}])|\d+(?:[.,]\d+)*|[\p{L}\p{M}]+(?:['’][\p{L}]+)?/giu
const MAX_RUPEES = 99999999

function tokenize(raw: string): Token[] {
  const hindi = /[\u0900-\u097F]/.test(raw)
  const text = raw
    .replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    // Google's Hindi recognizer breaks a number with a hyphen, "2-50", "1-500" and "100-0" beside Devanagari words
    // (lunch, groceries, shopping); in English, "2-3 days" is a range
    .replace(/(?<![\d.,-])(\d{1,3})-(\d{1,3})(?![\d.,]|-\d)/g, (m, a: string, b: string) => (hindi ? a + b : m))
    // "cash back" is one thing, not the cash account
    .replace(/\bcash\s+back\b/gi, (m) => (m[0] === 'C' ? 'Cashback' : 'cashback'))
  return [...text.matchAll(TOKEN)].map((m) => {
    let shown = m[0]
    let low = shown.toLowerCase()
    if (/[\u0900-\u097F]/.test(low)) low = DEVANAGARI[devanagari(low)] ?? devanagari(low)
    const fix = MISHEARD[low]
    if (fix) {
      shown = shown[0] !== shown[0].toLowerCase() ? fix[0].toUpperCase() + fix.slice(1) : fix
      low = fix
    }
    const ord = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(low)
    return {
      text: shown,
      low,
      key: low.replace(/['’]/g, ''),
      used: false,
      ord: ord ? Number(ord[1]) : undefined,
      clock: /^\d{1,2}:\d{2}$/.test(low)
    }
  })
}

/** The digits of a token as a number: "1,250" and "1,25,000" are grouped, "99.50" has paise. */
function digitValue(t: Token | undefined): number | null {
  if (!t || t.clock || t.ord !== undefined || !/^\d/.test(t.low)) return null
  const v = parseFloat(t.low.replace(/,/g, ''))
  return isFinite(v) ? v : null
}

/** Finds `phrase` (one or more lowercase words, no apostrophes) among unused tokens; returns its first index. */
function findPhrase(tokens: Token[], phrase: string, from = 0): number {
  const words = phrase.split(' ')
  outer: for (let i = from; i + words.length <= tokens.length; i++) {
    for (let j = 0; j < words.length; j++) {
      if (tokens[i + j].used || tokens[i + j].key !== words[j]) continue outer
    }
    return i
  }
  return -1
}

/**
 * Like findPhrase, and a one-word name may also come split in two or three ("G Pay", "D Mart", "H D F C"):
 * gives where it starts and how many tokens it took.
 */
function findName(tokens: Token[], name: string, from = 0): { at: number; count: number } | null {
  const words = name.split(' ')
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].used) continue
    if (i + words.length <= tokens.length && words.every((w, j) => !tokens[i + j].used && tokens[i + j].key === w)) {
      return { at: i, count: words.length }
    }
    if (words.length > 1 || !name.startsWith(tokens[i].key)) continue
    let joined = tokens[i].key
    for (let n = 2; n <= 3 && i + n <= tokens.length && !tokens[i + n - 1].used; n++) {
      joined += tokens[i + n - 1].key
      const letters = tokens.slice(i, i + n).every((t) => t.key.length === 1)
      if (joined === name && (name.length >= 4 || letters)) return { at: i, count: n }
      if (!name.startsWith(joined)) break
    }
  }
  return null
}

function consume(tokens: Token[], start: number, count: number) {
  for (let i = start; i < start + count && i < tokens.length; i++) tokens[i].used = true
}

/** A tag's or account's name, read the way speech is: lowercase, Devanagari as Latin. */
function nameKey(name: string): string {
  return tokenize(name.replace(/[^\p{L}\p{N}\p{M} ]/gu, ' '))
    .map((t) => t.key)
    .join(' ')
}

/* ------------------------------------------------------------------ the amount */

type Atom =
  | { t: 'num'; v: number; kind: 'digit' | 'unit' | 'ten' | 'hindi' | 'half'; clock?: boolean }
  | { t: 'scale'; v: number }
  | { t: 'mod'; v: number }
  | { t: 'and' }
  | { t: 'a' }

/** What token i is as part of a spoken number, if it is part of one. */
function atomAt(tokens: Token[], i: number): Atom | null {
  const tok = tokens[i]
  if (!tok || tok.used || tok.ord !== undefined) return null
  const w = tok.low
  if (tok.clock) {
    const [h, m] = w.split(':').map(Number)
    return { t: 'num', v: h * 100 + m, kind: 'digit', clock: true }
  }
  const d = digitValue(tok)
  if (d !== null) return { t: 'num', v: d, kind: 'digit' }
  if (w in UNITS) return { t: 'num', v: UNITS[w], kind: 'unit' }
  if (w in TENS) return { t: 'num', v: TENS[w], kind: 'ten' }
  if (SIXTY.has(w)) {
    // "Rahul ke saath", "saath mein" is together, not sixty
    const before = tokens[i - 1]?.low
    const after = tokens[i + 1]?.low
    if (before === 'ke' || before === 'ki' || before === 'kay' || after === 'mein' || after === 'me' || after === 'main') return null
    return { t: 'num', v: 60, kind: 'hindi' }
  }
  if (w in HINDI) return { t: 'num', v: HINDI[w], kind: 'hindi' }
  if (w in HALVES) return { t: 'num', v: HALVES[w], kind: 'half' }
  if (w in MODIFIERS) return { t: 'mod', v: MODIFIERS[w] }
  if (w in SCALES) return { t: 'scale', v: SCALES[w] }
  // "1.2 lock rent": how Google's English (India) recognizer wrote "1.2 lakh" beside it, twice in two voices. Only
  // after a decimal, which counts no locks
  if ((w === 'lock' || w === 'lack') && /^\d+\.\d+$/.test(tokens[i - 1]?.low ?? '')) return { t: 'scale', v: 1e5 }
  if (w in SHORT_SCALES) {
    // "5k", "2 cr", but not "R K Stores", "auto 80 to CR Park", "300 K R Puram"
    const prev = atomAt(tokens, i - 1)
    const next = tokens[i + 1]
    if (prev?.t !== 'num' || prev.clock || (next && next.key.length === 1 && /\p{L}/u.test(next.key))) return null
    return { t: 'scale', v: SHORT_SCALES[w] }
  }
  // "teen so pachas": "sau" written "so", right after a number word or a small number
  if (w === 'so') {
    const prev = atomAt(tokens, i - 1)
    const before = tokens[i - 1]
    const small = prev?.t === 'num' && !prev.clock && (before.low in UNITS || before.low in HALVES || (prev.kind === 'digit' && Number.isInteger(prev.v) && prev.v >= 1 && prev.v <= 19))
    return small ? { t: 'scale', v: 100 } : null
  }
  if (w === 'and') return { t: 'and' }
  if (w === 'a') return { t: 'a' }
  return null
}

interface NumberRead {
  value: number
  end: number // exclusive
  /** had a word in it, not only digits */
  words: boolean
  /** a scale word: "5 thousand", "dedh hazaar" */
  scaled: boolean
  /** two pieces made one: "two fifty", "2 50" */
  joined: boolean
  /** written like a time: "2:50" */
  clock: boolean
}

/**
 * Reads one number starting at token `start`: "250", "5k", "2 lakh", "two thousand five hundred", "dhai sau",
 * "saade teen sau", "1 lakh 20" (1,20,000), "100 and 50", and a price said in two pieces: "two fifty",
 * "2 50", "two 50", "2:50" — a 1-9 straight before a 10-99 is hundreds. Stops where the next word can't be part.
 */
function readNumber(tokens: Token[], start: number): NumberRead | null {
  const first = atomAt(tokens, start)
  if (!first || first.t === 'and') return null
  if (first.t === 'a' && atomAt(tokens, start + 1)?.t !== 'scale') return null
  if (first.t === 'mod' && atomAt(tokens, start + 1)?.t !== 'num' && atomAt(tokens, start + 1)?.t !== 'scale') return null

  let total = 0 // finished parts at a thousand or more: "2 lakh", "5 thousand"
  let cur = 0 // the part below them
  let has = false // cur holds a number
  let single = false // cur is one number as said, nothing joined or scaled onto it yet
  let lastKind: string | null = null
  let lastBig = Infinity // big scales must fall: lakh, then thousand
  let afterScale = false
  let afterHundred = false
  let bump = 0
  let words = false
  let scaled = false
  let joined = false
  let clock = false
  let j = start
  for (;;) {
    let a = atomAt(tokens, j)
    if (!a) break
    // "one and half 1000 shopping", "two and a half 1000": the recognizer wrote the scale word in digits
    if (a.t === 'num' && a.kind === 'digit' && has && !Number.isInteger(cur) && WRITTEN_SCALES.has(a.v)) a = { t: 'scale', v: a.v }
    if (a.t === 'mod') {
      // "saade teen sau": the number right after it is a half more; "sava sau", "paune sau": of one hundred
      const next = atomAt(tokens, j + 1)
      if (has && !afterScale) break
      if (next?.t === 'scale' && !has) {
        cur = 1 + a.v
        has = true
        single = false
        words = true
        j++
        continue
      }
      if (next?.t !== 'num') break
      bump = a.v
      words = true
      j++
      continue
    }
    if (a.t === 'a') {
      // "a hundred", "a lakh"
      if (has || atomAt(tokens, j + 1)?.t !== 'scale') break
      cur = 1
      has = true
      single = false
      words = true
      j++
      continue
    }
    if (a.t === 'and') {
      const h1 = tokens[j + 1]?.low
      const h2 = tokens[j + 2]?.low
      // "one and a half thousand", "2 and a half lakh"
      if (has && !afterScale && Number.isInteger(cur) && (h1 === 'half' || (h1 === 'a' && h2 === 'half'))) {
        cur += 0.5
        single = false
        words = true
        j += h1 === 'half' ? 2 : 3
        continue
      }
      // "hundred and fifty", "two thousand and fifty", "100 and 50": a smaller number filling a round one
      const n = atomAt(tokens, j + 1)
      if (n?.t === 'num' && !n.clock && (has || total > 0)) {
        const sofar = total + cur
        const room = 10 ** String(Math.floor(n.v)).length
        if (n.v >= 1 && Number.isInteger(n.v) && sofar > n.v && sofar % room === 0) {
          cur += n.v
          has = true
          single = false
          afterScale = false
          afterHundred = false
          lastKind = n.kind
          if (n.kind !== 'digit') words = true
          j += 2
          continue
        }
      }
      break
    }
    if (a.t === 'scale') {
      if (a.v === 100) {
        if ((has && cur >= 100) || afterHundred) break
        cur = (has ? cur : 1) * 100
        has = true
        afterHundred = true
      } else {
        if (a.v >= lastBig) break
        total += (has ? cur : 1) * a.v
        cur = 0
        has = false
        lastBig = a.v
        afterHundred = false
        // "1 lakh 20" is 1,20,000 and "ek crore bees" 1,20,00,000: a bare number under 100 ends it
        if (a.v >= 1e5) {
          const small = readSmall(tokens, j + 1)
          if (small && !atomAt(tokens, small.end)) {
            total += small.v * (a.v / 100)
            if (small.words) words = true
            scaled = true
            j = small.end
            break
          }
        }
      }
      if (!/^\d/.test(tokens[j].low)) words = true
      scaled = true
      afterScale = true
      single = false
      j++
      continue
    }
    // a number
    if (a.clock) {
      if (has || total > 0) break
      cur = a.v
      has = true
      clock = true
      j++
      break
    }
    const v = a.v + bump
    if (!has) {
      if (total > 0 && v >= lastBig) break
      cur = v
      has = true
      single = total === 0 && !afterScale && bump === 0
    } else if (afterScale) {
      // "do sau pachas", "one hundred fifty": the part after a hundred
      if (v >= 100 || cur % 100 !== 0) break
      cur += v
      single = false
    } else if (lastKind === 'ten' && a.kind === 'unit' && v >= 1 && v <= 9 && cur % 10 === 0) {
      // "ninety nine", "two twenty five"
      cur += v
      single = false
    } else if (single && joins(tokens[j - 1], lastKind, cur, a)) {
      // "two fifty", "2 50", "two 50", "do pachas": a price said in two pieces
      cur = cur * 100 + v
      joined = true
      single = false
    } else break
    bump = 0
    lastKind = a.kind
    afterScale = false
    afterHundred = false
    if (a.kind !== 'digit') words = true
    j++
  }
  if (!has && total === 0) return null
  return { value: total + cur, end: j, words, scaled, joined, clock }
}

/** Whether a number said alone (`left`, of kind `leftKind`) and the one after it make one price: "two fifty". */
function joins(leftTok: Token, leftKind: string | null, left: number, right: Extract<Atom, { t: 'num' }>): boolean {
  if (!Number.isInteger(left) || !Number.isInteger(right.v)) return false
  if (leftKind === 'digit') {
    // "2 50", "4 99", "2 fifty"; a digit before a Hindi word ("2 tees", two t-shirts) isn't one
    if (left < 1 || left > 9) return false
    if (right.kind === 'digit') return right.v >= 10 && right.v <= 99 && !/^\d+[.,]/.test(leftTok.low)
    return right.kind === 'ten' || (right.kind === 'unit' && right.v >= 10)
  }
  if (leftKind === 'unit') {
    // "two fifty", "twelve fifty", "two 50", "do pachas", "nine ninety nine"
    if (left < 1 || left > 19) return false
    return right.v >= 10 && right.v <= 99 && right.kind !== 'half'
  }
  return false
}

/** A number under 100 said on its own: "20", "bees", "twenty five". */
function readSmall(tokens: Token[], i: number): { v: number; end: number; words: boolean } | null {
  const a = atomAt(tokens, i)
  if (!a || a.t !== 'num' || a.clock || !Number.isInteger(a.v) || a.v < 1 || a.v >= 100) return null
  const b = atomAt(tokens, i + 1)
  if (a.kind === 'ten' && b?.t === 'num' && b.kind === 'unit' && b.v >= 1 && b.v <= 9) return { v: a.v + b.v, end: i + 2, words: true }
  return { v: a.v, end: i + 1, words: a.kind !== 'digit' }
}

interface Candidate {
  value: number
  start: number
  end: number // exclusive
  /** a currency word with it: "Rs 250", "50 rupees" */
  marked: boolean
  /** right after "paid", "spent": what it cost */
  priced: boolean
  /** counting something: "2 kg", "3 people" */
  counted: boolean
  /** a time of day: "2:50", "at 9 30" */
  timeLike: boolean
  /** a place's number: "sector 62", "flat 2304" */
  label: boolean
}

function amountCandidates(tokens: Token[]): Candidate[] {
  const out: Candidate[] = []
  for (let i = 0; i < tokens.length; i++) {
    const r = readNumber(tokens, i)
    if (!r) continue
    // what's around it, not counting words already read as something else ("180 G Pay": no grams)
    const before = tokens[i - 1]?.used ? undefined : tokens[i - 1]?.low
    const after = tokens[r.end]?.used ? undefined : tokens[r.end]?.low
    const marked = (before !== undefined && CURRENCY.has(before)) || (after !== undefined && CURRENCY.has(after))
    // "one coffee" or "do" alone isn't a price; a scale word, a currency word or ten-plus is
    if (r.value > 0 && (!r.words || marked || r.scaled || r.value >= 10)) {
      out.push({
        value: r.value,
        start: i,
        end: r.end,
        marked,
        priced: before !== undefined && PRICED.has(before),
        counted: after !== undefined && UNITS_AFTER.has(after),
        timeLike: r.clock || (r.joined && before !== undefined && AT_TIME.has(before)),
        label: before !== undefined && LABELS.has(before)
      })
    }
    i = r.end - 1
  }
  return out
}

function pickAmount(tokens: Token[]): { minor: number; at: number } | null {
  const valid = amountCandidates(tokens).filter((c) => c.value > 0 && c.value <= MAX_RUPEES && !c.label)
  const pool = [
    // a number wearing a currency word
    valid.filter((c) => c.marked),
    // the number right after "paid": "paid 50 for 100 photocopies"
    valid.filter((c) => c.priced && !c.counted),
    // otherwise the biggest number that isn't counting something ("2 coffees 250", "500 for 2 months") or a time
    valid.filter((c) => !c.counted && !c.timeLike),
    // and a time-like one when that's all there is: "2:50 lunch" is two fifty
    valid.filter((c) => !c.counted)
  ].find((p) => p.length > 0)
  if (!pool) return null
  const best = pool.reduce((a, b) => (b.value > a.value ? b : a))
  consume(tokens, best.start, best.end - best.start)
  // the currency word that came with it isn't part of the note, nor is a "won" (one) misheard before it
  const before = tokens[best.start - 1]
  if (before && (CURRENCY.has(before.low) || before.low === 'won')) before.used = true
  if (tokens[best.end] && CURRENCY.has(tokens[best.end].low)) tokens[best.end].used = true
  return { minor: Math.round(best.value * 100), at: best.start }
}

/* ------------------------------------------------------------------ the date */

/** The `day` of `month` (or of this month, or last month if that day hasn't come yet) on or before today. */
function dayOfMonthISO(today: string, day: number, month?: number): string | null {
  const [ty, tm, td] = today.split('-').map(Number)
  let y = ty
  let m = month ?? tm
  if (month === undefined) {
    if (day > td) m -= 1
  } else if (month > tm || (month === tm && day > td)) y -= 1
  if (m < 1) {
    m = 12
    y -= 1
  }
  if (day < 1 || day > new Date(y, m, 0).getDate()) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "on the 3rd", "3rd November", "November 5th", "on the twenty fifth", "3 tarikh": a day of a month. */
function pickDayOfMonth(tokens: Token[], today: string): string | null | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.used) continue
    // the day, and how many tokens it took
    let day: number | undefined
    let n = 1
    let ordinal = true
    if (t.ord !== undefined) day = t.ord
    else if (t.low in ORDINALS) day = ORDINALS[t.low]
    else if ((t.low === 'twenty' || t.low === 'thirty') && (ORDINALS[tokens[i + 1]?.low] ?? 10) < 10) {
      day = TENS[t.low] + ORDINALS[tokens[i + 1].low]
      n = 2
    } else {
      const d = digitValue(t)
      if (d !== null && Number.isInteger(d) && d >= 1 && d <= 31 && !/[.,]/.test(t.low)) {
        day = d
        ordinal = false
      }
    }
    if (day === undefined || day > 31) continue
    // a month next to it, before ("November 5th") or after ("3rd November", "3rd of Nov")
    let month: number | undefined
    let from = i
    let to = i + n
    const prev = tokens[i - 1]
    if (prev && !prev.used && prev.low in MONTHS) {
      month = MONTHS[prev.low]
      from = i - 1
    } else {
      const of = tokens[to]?.low === 'of' ? 1 : 0
      const next = tokens[to + of]
      if (next && !next.used && next.low in MONTHS) {
        month = MONTHS[next.low]
        to += of + 1
      }
    }
    const tarikh = TARIKH.has(tokens[to]?.low)
    const before = tokens[from - 1]?.low
    const lead = before === 'the' ? (tokens[from - 2]?.low === 'on' ? 2 : 1) : before === 'on' ? 1 : 0
    // a bare number is a day only with a month or "tarikh"; "2nd hand" is no date, "on the 2nd" and "3rd ko" are
    if (!month && !tarikh && !(ordinal && (lead > 0 || tokens[to]?.low === 'ko'))) continue
    const iso = dayOfMonthISO(today, day, month)
    if (!iso) continue
    if (tarikh) to += tokens[to + 1]?.low === 'ko' ? 2 : 1
    else if (tokens[to]?.low === 'ko') to += 1
    consume(tokens, from - lead, to - from + lead)
    return iso === today ? undefined : iso
  }
  return null
}

function pickDate(tokens: Token[], today: string): string | undefined {
  // 1) said outright
  const phrases: [string, number][] = [
    ['day before yesterday', -2],
    ['parso', -2],
    ['parson', -2],
    ['yesterday', -1],
    ['last night', -1],
    ['kal', -1],
    ['today', 0],
    ['this morning', 0],
    ['tonight', 0],
    ['aaj', 0]
  ]
  for (const [phrase, days] of phrases) {
    const at = findPhrase(tokens, phrase)
    if (at >= 0) {
      const n = phrase.split(' ').length
      consume(tokens, at, n)
      const after = tokens[at + n]
      if (after && !after.used && TIME_OF_DAY.has(after.low)) after.used = true
      return days === 0 ? undefined : addDaysISO(today, days)
    }
  }
  // 2) "two days ago", "4 days back", "teen din pehle", "a week ago"
  for (let i = 1; i < tokens.length; i++) {
    const u = tokens[i].low
    const per = ['day', 'days', 'din'].includes(u) ? 1 : ['week', 'weeks', 'hafta', 'hafte'].includes(u) ? 7 : 0
    if (!per || tokens[i].used || !AGO.has(tokens[i + 1]?.low ?? '')) continue
    const w = tokens[i - 1]
    const d = digitValue(w)
    const count = ['a', 'an', 'one', 'ek'].includes(w.low) ? 1 : d !== null && Number.isInteger(d) ? d : w.low in UNITS ? UNITS[w.low] : null
    if (!count || count > 60 || w.used) continue
    consume(tokens, i - 1, 3)
    return addDaysISO(today, -count * per)
  }
  // 3) a day of the month
  const dom = pickDayOfMonth(tokens, today)
  if (dom !== null) return dom
  // 4) a weekday: the last one, "last Monday" the one before if today is Monday
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

/* ------------------------------------------------------------------ the account */

function pickAccount(tokens: Token[], accounts: Account[]): string | undefined {
  const active = accounts.filter((a) => !a.archived)
  if (active.length === 0) return undefined
  // the person's own account names first ("HDFC", "Paytm wallet"), longest first
  const named: [string, string][] = active.map((a) => [nameKey(a.name), a.id] as [string, string]).filter(([n]) => n.length > 0)
  const aliases: [string, string][] = Object.entries(PAY_ALIASES)
    .map(([word, id]) => {
      const byName = active.find((a) => nameKey(a.name) === word)
      const byId = active.find((a) => a.id === id)
      return [word, (byName ?? byId)?.id ?? ''] as [string, string]
    })
    .filter(([, id]) => id)
  const all = [...named, ...aliases].sort((a, b) => b[0].split(' ').length - a[0].split(' ').length)
  for (const [phrase, id] of all) {
    let m = findName(tokens, phrase)
    while (m) {
      const b1 = tokens[m.at - 1]
      const b2 = tokens[m.at - 2]
      const after = tokens[m.at + m.count]
      // "by card", "from my card", "card se"
      const owned = !!b1 && !b1.used && OWNERS.has(b1.low) && !!b2 && !b2.used && PAY_CONNECTORS.has(b2.low)
      const connected = (!!b1 && !b1.used && PAY_CONNECTORS.has(b1.low)) || owned
      const trailed = !!after && !after.used && PAY_AFTER.has(after.low)
      if (connected || trailed || !NEEDS_CONNECTOR.has(phrase)) {
        consume(tokens, m.at, m.count)
        if (connected) b1.used = true
        if (owned) b2.used = true
        if (trailed) after.used = true
        return id
      }
      m = findName(tokens, phrase, m.at + 1)
    }
  }
  return undefined
}

/* ------------------------------------------------------------------ the tag */

const nameOf = (c: Category) => nameKey(c.name)
const plainName = (c: Category) => PLAIN_NAMES[c.id] !== undefined && PLAIN_NAMES[c.id] === nameOf(c)

interface Hit {
  id: string
  group: number
  at: number
  count: number
  word: string
}

/** Every everyday word or brand among `toks` that names a tag: "chai", "D Mart", "Domino's", "big basket". */
function synonymHits(toks: Token[], groups: [string, string[]][]): Hit[] {
  const hits: Hit[] = []
  groups.forEach(([id, words], group) => {
    for (const word of words) {
      const parts = word.split(' ')
      for (let i = 0; i < toks.length; i++) {
        const k = toks[i].key
        if (parts.length > 1) {
          // "big basket", "ice cream", the last word maybe plural
          if (i + parts.length <= toks.length && parts.every((p, j) => toks[i + j].key === p || (j === parts.length - 1 && toks[i + j].key === p + 's'))) {
            hits.push({ id, group, at: i, count: parts.length, word })
          }
          continue
        }
        // the word, or its plural: "coffees", "samosas"
        if (k === word || k === word + 's' || k === word + 'es') {
          hits.push({ id, group, at: i, count: 1, word })
          continue
        }
        // a name the recognizer split: "D Mart", "Book My Show", "Pharm Easy", "K F C"
        if (!word.startsWith(k)) continue
        let joined = k
        for (let n = 2; n <= 3 && i + n <= toks.length; n++) {
          joined += toks[i + n - 1].key
          const letters = toks.slice(i, i + n).every((t) => t.key.length === 1)
          if ((joined === word || joined === word + 's') && (word.length >= 4 || letters)) {
            hits.push({ id, group, at: i, count: n, word })
            break
          }
          if (!word.startsWith(joined)) break
        }
      }
    }
  })
  return hits
}

/** Which of the words found says the tag. */
function bestHit(hits: Hit[], kind: 'out' | 'in'): Hit | null {
  if (hits.length === 0) return null
  let pool = hits
  // money in looks at the income tags first: a refund from Amazon is a Return, not Online
  if (kind === 'in' && pool.some((h) => INCOME_TAGS.has(h.id))) pool = pool.filter((h) => INCOME_TAGS.has(h.id))
  // the longest name said: "Jio Mart" is groceries, "Jio" alone a recharge
  const longest = Math.max(...pool.map((h) => h.count))
  pool = pool.filter((h) => h.count === longest)
  // a brand inside a platform: "Swiggy Instamart" is groceries, "Amazon Prime" entertainment
  if (pool.some((h) => BRANDS.has(h.word))) pool = pool.filter((h) => !PLATFORMS.has(h.word))
  // otherwise the tags' own order
  return pool.reduce((a, b) => (b.group < a.group || (b.group === a.group && b.at < a.at) ? b : a))
}

function synonymGroups(active: Category[]): [string, string[]][] {
  return Object.entries(SYNONYMS).filter(([id]) => active.some((c) => c.id === id))
}

/** Whether the sentence names something bought ("groceries", "Uber", "medicine"), not money or a person. */
function namesAPurchase(tokens: Token[], categories: Category[]): boolean {
  const spends = categories.filter((c) => !c.archived && !INCOME_TAGS.has(c.id) && c.id !== 'people')
  const free = tokens.filter((t) => !t.used)
  if (spends.some((c) => !plainName(c) && nameOf(c) && findPhrase(free, nameOf(c)) >= 0)) return true
  return synonymHits(free, synonymGroups(spends)).length > 0
}

function pickCategory(tokens: Token[], kind: 'out' | 'in', categories: Category[]): string | null {
  // a spend never gets a tag for money coming in
  const active = categories.filter((c) => !c.archived && (kind === 'in' || !INCOME_TAGS.has(c.id)))
  const byName = (c: Category) => {
    const name = nameOf(c)
    const at = name ? findPhrase(tokens, name) : -1
    if (at < 0) return false
    consume(tokens, at, name.split(' ').length)
    return true
  }
  // 1) a word that is a tag's name ("shopping", "rent", "bills & recharge"): it says the tag, not a note
  for (const c of active) if (!plainName(c) && byName(c)) return c.id
  // 2) everyday words and brands ("chai" → Food, "D Mart" → Groceries); the words stay in the note, a name
  //    the recognizer split up stays whole there ("Book My Show"). A tag's own name that is a plain word
  //    ("paid online for wifi") waits for step 3
  const free = tokens.filter((t) => !t.used)
  const hits = synonymHits(free, synonymGroups(active)).filter((h) => !(PLAIN_NAMES[h.id] === h.word && active.some((c) => c.id === h.id && plainName(c))))
  const hit = bestHit(hits, kind)
  if (hit) {
    if (hit.count > 1) for (let i = hit.at; i < hit.at + hit.count; i++) free[i].whole = true
    return hit.id
  }
  // 3) a tag name that is also a plain word ("people", "online", "other"), once nothing else named a tag
  for (const c of active) if (plainName(c) && byName(c)) return c.id
  // 4) part of a tag name ("medic" → Medical), only once nothing surer matched:
  //    "chai at the corner shop" is Food, not Shopping
  const words = tokens.filter((t) => !t.used).map((t) => t.low)
  return active.find((c) => words.some((w) => w.length >= 4 && !FILLERS.has(w) && c.name.toLowerCase().includes(w)))?.id ?? null
}

/* ------------------------------------------------------------------ money in or out */

// words for things and shops, which hand over goods, not money: "Amazon sent the order"
const THING_WORDS = new Set([...PLATFORMS, ...Object.entries(SYNONYMS).flatMap(([id, words]) => (id === 'people' ? [] : words))])

/** A word that can be someone's name: letters, and not a glue word, a number, a day, a thing or the speaker. */
function isSomeone(w: string | undefined): boolean {
  return (
    w !== undefined &&
    // letters, with Devanagari's vowel signs: "राहुल ने 500 दिए"
    /^\p{L}[\p{L}\p{M}]*$/u.test(w) &&
    !FILLERS.has(w) &&
    !SELF.has(w) &&
    !isNumberWord(w) &&
    !DATE_WORDS.has(w) &&
    !CURRENCY.has(w) &&
    !THING_WORDS.has(w)
  )
}

function pickKind(tokens: Token[], amountAt: number, purchase: boolean, payWords: Set<string>): 'out' | 'in' {
  const w = tokens.map((t) => t.low)
  const low = ' ' + w.join(' ') + ' '
  // 1) money handed to someone: "returned 500 to Rahul", "sent 2000 to mom", "Rahul ko 500 wapas diye"
  const ko = w.findIndex((x, i) => x === 'ko' && isSomeone(w[i - 1]))
  if (ko > 0 && w.slice(ko + 1).some((x) => GAVE_HI.has(x) || x === 'wapas' || x === 'vapas' || x === 'paid' || x === 'pay')) return 'out'
  for (let i = 0; i < w.length; i++) {
    if (!HANDED.has(w[i])) continue
    const to = w.indexOf('to', i + 1)
    const who = w[to + 1] === 'the' ? w[to + 2] : w[to + 1]
    if (to > 0 && isSomeone(who) && !payWords.has(who!)) return 'out'
  }
  // 2) money that came in
  if (STRONG_IN.test(low)) return 'in'
  // someone else handing it over: "Rahul gave 500", "Mom sent 5000", "papa ne 2000 bheje"
  const gave = w.findIndex((x) => GAVE.has(x))
  if (gave > 0 && isSomeone(w[gave - 1])) return 'in'
  const ne = w.findIndex((x, i) => x === 'ne' && isSomeone(w[i - 1]))
  if (ne > 0 && w.slice(ne + 1).some((x) => GAVE_HI.has(x))) return 'in'
  // "got 500", "got back", "got paid", "got Rs 500" — not "got 2 coffees for 300"
  const got = w.indexOf('got')
  const next = w[got + 1]
  if (got >= 0 && (next === 'back' || next === 'paid' || amountAt === got + 1 || (amountAt === got + 2 && CURRENCY.has(next)))) return 'in'
  // 3) money that went out
  if (OUT_CUES.test(low)) return 'out'
  // 4) pay coming in ("salary 50000", "got salary"), unless it's someone else's: "maid salary", "driver ka bonus"
  const someoneElses = (i: number) => {
    const b1 = w[i - 1]?.replace(/['’]s$/, '')
    const b2 = w[i - 2]
    return PAYEES.has(b1 ?? '') || (['ka', 'ki', 'ke', 'ko'].includes(b1 ?? '') && PAYEES.has(b2 ?? '')) || (['to', 'for'].includes(w[i + 1] ?? '') && PAYEES.has(w[i + 2] ?? ''))
  }
  if (w.some((x, i) => PAY_IN.has(x) && !someoneElses(i))) return 'in'
  // "got 2 coffees for 300", "got coffee" are purchases
  if (got >= 0) return 'out'
  // 5) "500 aaye" came in; "bill aaya", "khana aaya" are things that came
  if (!purchase && w.some((x) => CAME.has(x))) return 'in'
  // 6) "from Rahul" is money in; "from DMart", "from office" is where a spend happened; "from cash" says how it was paid
  const from = w.indexOf('from')
  if (from >= 0) {
    let who = w[from + 1]
    if (who === 'the' || who === 'my' || who === 'a') who = w[from + 2]
    if (isSomeone(who) && !payWords.has(who!)) return KIN.has(who!) || !purchase ? 'in' : 'out'
  }
  return 'out'
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
  const payWords = new Set([...PAY_WORDS, ...accounts.filter((a) => !a.archived).map((a) => nameKey(a.name).split(' ')[0] ?? '')].filter(Boolean))

  // the day and the account first, so "on the 3rd" and "card se" aren't read as the amount or the note
  const dateISO = pickDate(tokens, today)
  const accountId = pickAccount(tokens, accounts)
  const amount = pickAmount(tokens)
  const kind = pickKind(tokens, amount?.at ?? -1, namesAPurchase(tokens, categories), payWords)
  let categoryId = pickCategory(tokens, kind, categories)

  // the note keeps the recognizer's capitals ("Rahul", "Zudio") and drops the glue words, though not from a name
  // said in pieces: "Book My Show", "A K Stores"
  const free = tokens.filter((t) => !t.used)
  free.forEach((t, i) => {
    const letter = (x: Token | undefined) => !!x && x.key.length === 1 && /\p{L}/u.test(x.key)
    if (letter(t) && (letter(free[i - 1]) || letter(free[i + 1]))) t.whole = true
  })
  const noteWords = free.filter((t) => t.whole || (!FILLERS.has(t.low) && !CURRENCY.has(t.low))).map((t) => t.text)
  let note = noteWords.join(' ').slice(0, 60).trim()
  if (note) note = note[0].toUpperCase() + note.slice(1)

  const active = categories.filter((c) => !c.archived && (kind === 'in' || !INCOME_TAGS.has(c.id)))
  // the person's own history knows best ("zudio" → whatever they tagged it last time)
  if (!categoryId && note) {
    const guess = guessCategory(note, recent)
    if (guess && active.some((c) => c.id === guess)) categoryId = guess
  }
  // money in from someone, with nothing more specific said, is a payment
  if (!categoryId && kind === 'in' && active.some((c) => c.id === 'payment')) categoryId = 'payment'

  const parsed: ParsedSpeech = { amountMinor: amount?.minor ?? null, kind, note, categoryId }
  if (dateISO) parsed.dateISO = dateISO
  if (accountId) parsed.accountId = accountId
  return parsed
}

/* ------------------------------------------------------------------ trips */

/** How a name sounds, near enough: "Meera" and "Mira", "Aarav" and "Arav", "Mohit" and "Mohith" come out the same. */
function soundOf(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/([kgcjtdbps])h/g, '$1')
    .replace(/ee|ii|iy/g, 'i')
    .replace(/oo|uu/g, 'u')
    .replace(/(.)\1+/g, '$1')
}

/**
 * On a trip, someone else may have paid: "Rahul paid 800 cab", "800 cab paid by Rahul", "Rahul ne 800 diye",
 * "Rahul ne cab ka 800 pay kiya", and "Mira paid" for Meera. Gives who, and the sentence without them for
 * parseSpeech to read.
 */
export function tripPayer(raw: string, people: { id: string; name: string }[]): { text: string; paidBy: string | null } {
  const heard = raw.split(/\s+/).filter((x) => /\p{L}/u.test(x))
  const payHi = '(?:pay|paid|payment) (?:kiya|kiye|ki|kar diya|kar diye|kar di|kiya hai)'
  for (const p of people) {
    if (p.id === 'me') continue
    const full = p.name.trim()
    const first = full.split(/\s+/)[0] ?? ''
    // the name as written, then a word that sounds like it ("Mira" for Meera); never part of a word ("Karanataka")
    const sound = soundOf(first)
    const alike = sound.length >= 3 ? heard.filter((x) => soundOf(x) === sound) : []
    const names = [...new Set([full, first, ...alike].filter(Boolean))].map(escapeRe)
    for (const name of names) {
      const said = new RegExp(`(?:^|\\s)(?:(?:paid|payment) by ${name}|${name} (?:has )?(?:paid|pays)|${name} ne ${payHi})(?=\\s|$)`, 'iu')
      const ne = new RegExp(`(?:^|\\s)${name} ne(?=\\s)(.*?)\\s(?:diya|diye|di|bhara|bhare|${payHi})(?=\\s|$)`, 'iu')
      const m = raw.match(said)
      if (m) return { text: raw.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), paidBy: p.id }
      const n = raw.match(ne)
      if (n) return { text: raw.replace(n[0], ` ${n[1]} `).replace(/\s+/g, ' ').trim(), paidBy: p.id }
    }
  }
  return { text: raw, paidBy: null }
}

/** What was said, as an entry. On a trip, who paid comes out first, so the rest reads like any spend. */
export function readSpeech(
  text: string,
  trip: Trip | null,
  categories: Category[],
  recent: Txn[],
  accounts: Account[],
  today?: string
): ParsedSpeech {
  const { text: rest, paidBy } = trip ? tripPayer(text, trip.people) : { text, paidBy: null }
  const parsed = parseSpeech(rest, categories, recent, accounts, today)
  return paidBy ? { ...parsed, paidBy } : parsed
}

/* ------------------------------------------------------------------ the recognizer's alternatives */

export interface Heard {
  text: string
  /** the recognizer's own confidence, 0..1, or -1 when it gave none */
  confidence: number
  parsed: ParsedSpeech
}

// what a misheard number leaves in a note: "to 50 lunch", "won 80 parking"
const HOMOPHONES = new Set(['to', 'too', 'two', 'for', 'four', 'fore', 'won', 'one', 'and'])
const bareNote = (note: string) =>
  note
    .toLowerCase()
    .split(/\s+/)
    .filter((x) => x && !/^\d/.test(x) && !HOMOPHONES.has(x) && !isNumberWord(x))
    .join(' ')

/** Two readings that differ only in the amount. */
function sameButAmount(a: ParsedSpeech, b: ParsedSpeech): boolean {
  return (
    a.kind === b.kind &&
    a.categoryId === b.categoryId &&
    a.dateISO === b.dateISO &&
    a.accountId === b.accountId &&
    a.paidBy === b.paidBy &&
    bareNote(a.note) === bareNote(b.note)
  )
}

/** `long` ends in `short`'s digits, whole rupees: 250 and 50, 499 and 99, 120 and 20. */
function endsIn(long: number, short: number): boolean {
  return long > short && long % 100 === 0 && short % 100 === 0 && String(long / 100).endsWith(String(short / 100))
}

/** A number straight after a word that may be a lost piece of it: "to 50", "for fifty", "won 80". */
function lostPiece(text: string): boolean {
  const t = tokenize(text)
  return t.some((x, i) => HOMOPHONES.has(x.low) && t[i + 1] !== undefined && (digitValue(t[i + 1]) !== null || isNumberWord(t[i + 1].low)))
}

/**
 * Below this, the recognizer's score for its first reading says it wasn't sure what it heard. Google's scores
 * crowd near 1: in a study of 480 utterances through Google's speech-to-text, 0.93 was the line that caught 85%
 * of the utterances with a word wrong while letting 75% of the right ones through (Nowrin and Vertanen, PETRA '25,
 * arXiv 2410.20564). Android's Google recognizer scores only its first reading, the rest come as 0, and Chrome
 * gave 0 for every reading in Taily's hearing check: so 0, like -1, is no score, not a low one.
 */
export const LOW_CONFIDENCE = 0.93

export interface Picked {
  /** the reading to save, or to show */
  best: Heard
  all: Heard[]
  /**
   * Safe to save without asking: the recognizer's own first reading has the amount, every reading with an amount
   * has the same one, and the recognizer didn't score its first reading low.
   */
  sure: boolean
  /** the other amounts heard, one reading each, in the recognizer's order */
  others: Heard[]
}

/**
 * Of the recognizer's alternatives, the one to save. A reading with an amount beats one without. A price said
 * in pieces goes to the reading that heard all of it: "to 50 lunch" beside "250 lunch" or "two 50 lunch" is
 * 250, which is how "to", "for" and "won" (two, four, one) get trusted, only when another alternative agrees;
 * without such a word, "Amazon 999" stays 999 beside "Amazon 9999". Otherwise the recognizer knows best: its
 * confidence, then its order. A tag found in one reading only decides between readings of the same amount that
 * the recognizer ranks the same.
 */
export function pickAlternative(alternatives: { text: string; confidence: number }[], read: (text: string) => ParsedSpeech): Picked {
  const all: Heard[] = alternatives.map((a) => ({ text: a.text, confidence: a.confidence, parsed: read(a.text) }))
  const conf = (h: Heard) => Math.max(0, h.confidence)
  const prefer = (pool: Heard[]): Heard => {
    const top = pool.reduce((a, b) => (conf(b) > conf(a) ? b : a))
    return pool.find((h) => h.parsed.amountMinor === top.parsed.amountMinor && conf(h) === conf(top) && h.parsed.categoryId) ?? top
  }
  const priced = all.filter((h) => h.parsed.amountMinor)
  if (priced.length === 0) {
    // nothing to save: what found a tag or a note goes on to the add sheet
    const found = all.filter((h) => h.parsed.categoryId || h.parsed.note)
    return { best: found.length ? prefer(found) : all[0], all, sure: false, others: [] }
  }
  let best = prefer(priced)
  for (let step = 0; step < priced.length && lostPiece(best.text); step++) {
    const whole = priced.filter((h) => endsIn(h.parsed.amountMinor!, best.parsed.amountMinor!) && sameButAmount(h.parsed, best.parsed))
    if (whole.length === 0) break
    best = prefer(whole)
  }
  const amount = best.parsed.amountMinor
  const first = all[0]
  const sure =
    first.parsed.amountMinor === amount &&
    priced.every((h) => h.parsed.amountMinor === amount) &&
    !(first.confidence > 0 && first.confidence < LOW_CONFIDENCE)
  const others: Heard[] = []
  for (const h of priced) {
    if (h.parsed.amountMinor !== amount && !others.some((o) => o.parsed.amountMinor === h.parsed.amountMinor)) others.push(h)
  }
  return { best, all, sure, others }
}
