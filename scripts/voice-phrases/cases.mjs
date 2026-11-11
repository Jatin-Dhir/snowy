// Voice phrase battery for scripts/voice-phrases/run.mjs. Expectations = what the speaker meant, not what the
// parser does. The first 191 (groups 1-13) are the 2.13.0 measurement, unchanged except for two `note` checks;
// the `fresh` ones were written for 2.13.1 before any fix, one set per cause, so the fixes aren't tuned on them.
// c(group, text, rupees, kind, tag, extras)
//   tag: id | null | [ids] (any of; include null if "no tag" is fine)
//   extras: date (day offset | {wd, last} | {dom} | {md:[m,d]}), acc, payer, note (the saved note, exactly),
//           amb ('why it is ambiguous': listed, not scored), held ('why it fails on purpose': scored, listed apart),
//           fresh (the cause it checks, 1-12; 13 = leftover fragments in notes)
// a(group, [[text, confidence], ...], rupees, kind, tag, extras): recognizer alternatives
export const GROUPS = {
  1: 'Plain',
  2: 'Money formats',
  3: 'Numbers in words',
  4: 'Hindi numbers (Latin)',
  5: 'Devanagari',
  6: 'Merchants & everyday words',
  7: 'Dates',
  8: 'Accounts',
  9: 'Money in',
  10: 'Recognizer slips',
  11: 'Trip payer',
  12: 'Alternatives ranking',
  13: 'Probes: correct transcripts',
  14: 'Google heard it (synthetic)'
}

const cases = []
const c = (g, t, rupees, kind, tag, x = {}) => cases.push({ g, t, rupees, kind, tag, ...x })
const a = (g, alts, rupees, kind, tag, x = {}) => cases.push({ g, alts, t: alts[0][0], rupees, kind, tag, ...x })

// 1 Plain
c(1, '250 lunch', 250, 'out', 'food')
c(1, 'lunch 250', 250, 'out', 'food')
c(1, 'spent 500 on groceries', 500, 'out', 'groceries')
c(1, 'I paid 1200 for electricity bill', 1200, 'out', 'bills')
c(1, 'dinner 800', 800, 'out', 'food')
c(1, 'bought shoes for 2000', 2000, 'out', 'shopping')
c(1, 'coffee 150', 150, 'out', 'food')
c(1, 'movie tickets 600', 600, 'out', 'entertainment')
c(1, 'paid 450 for dinner', 450, 'out', 'food')
c(1, '2 coffees 300', 300, 'out', 'food')
c(1, 'lunch for 3 people 900', 900, 'out', 'food', { note: 'Lunch 3 people' })
c(1, 'spent 60 on chai and biscuits', 60, 'out', 'food')
c(1, 'coffee 80 and sandwich 120', 200, 'out', 'food', { amb: 'two items: a 200 total or two entries' })

// 2 Money written the ways a recognizer writes it
c(2, 'Rs 250 lunch', 250, 'out', 'food')
c(2, 'Rs. 250 lunch', 250, 'out', 'food')
c(2, '₹250 lunch', 250, 'out', 'food')
c(2, '250 rupees lunch', 250, 'out', 'food')
c(2, 'rupees 250 lunch', 250, 'out', 'food')
c(2, '250/- lunch', 250, 'out', 'food')
c(2, '1,250 groceries', 1250, 'out', 'groceries')
c(2, '₹1,250.50 groceries', 1250.5, 'out', 'groceries')
c(2, '250 bucks lunch', 250, 'out', 'food')
c(2, 'INR 500 dinner', 500, 'out', 'food')
c(2, 'Rs250 lunch', 250, 'out', 'food')
c(2, '1,25,000 rent', 125000, 'out', 'rent')
c(2, '250 rupaye ka lunch', 250, 'out', 'food')
c(2, 'Rs 1.5k shopping', 1500, 'out', 'shopping')

// 3 Numbers in words
c(3, 'two fifty lunch', 250, 'out', 'food')
c(3, 'fifteen hundred groceries', 1500, 'out', 'groceries')
c(3, 'one and a half thousand shopping', 1500, 'out', 'shopping')
c(3, '2.5k shopping', 2500, 'out', 'shopping')
c(3, '5k rent', 5000, 'out', 'rent')
c(3, '1 lakh 20 thousand rent', 120000, 'out', 'rent')
c(3, 'twelve hundred fifty petrol', 1250, 'out', 'transport')
c(3, 'two thousand five hundred groceries', 2500, 'out', 'groceries')
c(3, 'four ninety nine Netflix', 499, 'out', 'entertainment')
c(3, 'one fifty auto', 150, 'out', 'transport')
c(3, 'nine ninety nine shoes', 999, 'out', 'shopping')
c(3, 'fifty rupees chai', 50, 'out', 'food')
c(3, 'two and a half thousand groceries', 2500, 'out', 'groceries')
c(3, 'salary 1 lakh 20', 120000, 'in', 'salary') // "ek lakh bees" = 1,20,000

// 4 Hindi numbers in Latin letters
c(4, 'do sau lunch', 200, 'out', 'food')
c(4, 'teen sau pachas petrol', 350, 'out', 'transport')
c(4, 'dhai sau ka khana', 250, 'out', 'food')
c(4, 'dedh hazaar shopping', 1500, 'out', 'shopping')
c(4, 'saade teen sau ka petrol', 350, 'out', 'transport')
c(4, 'paanch sau ka petrol', 500, 'out', 'transport')
c(4, 'ek hazaar do sau ki shopping', 1200, 'out', 'shopping')
c(4, 'pachas rupaye ki chai', 50, 'out', 'food')
c(4, 'chaar sau assi groceries', 480, 'out', 'groceries')
c(4, 'sava do sau auto', 225, 'out', 'transport')
c(4, 'dhai hazaar ka recharge', 2500, 'out', 'bills')
c(4, 'teen so pachas petrol', 350, 'out', 'transport') // "sau" written "so"
c(4, 'pachpan rupaye chai', 55, 'out', 'food')
c(4, 'saath rupaye ka doodh', 60, 'out', 'groceries')

// 5 Devanagari
c(5, 'खाना 250', 250, 'out', 'food')
c(5, 'दो सौ चाय', 200, 'out', 'food')
c(5, '250 का पेट्रोल', 250, 'out', 'transport')
c(5, 'पेट्रोल 500', 500, 'out', 'transport')
c(5, 'दूध 60', 60, 'out', 'groceries')
c(5, 'किराया 15000', 15000, 'out', 'rent')
c(5, 'ढाई सौ का खाना', 250, 'out', 'food')
c(5, '500 रुपये सब्जी', 500, 'out', 'groceries')
c(5, 'दवाई 300', 300, 'out', 'health')

// 6 Merchants and everyday words
c(6, 'Swiggy 340', 340, 'out', 'food')
c(6, 'Zomato 450', 450, 'out', 'food')
c(6, 'Uber 230', 230, 'out', 'transport')
c(6, 'Ola 180', 180, 'out', 'transport')
c(6, 'Rapido 60', 60, 'out', 'transport')
c(6, 'auto 80', 80, 'out', 'transport')
c(6, 'metro 40', 40, 'out', 'transport')
c(6, 'Blinkit 520', 520, 'out', 'groceries')
c(6, 'Zepto 310', 310, 'out', 'groceries')
c(6, 'BigBasket 1500', 1500, 'out', 'groceries')
c(6, 'Big Basket 1500', 1500, 'out', 'groceries')
c(6, 'DMart 2200', 2200, 'out', 'groceries')
c(6, 'D Mart 2200', 2200, 'out', 'groceries')
c(6, 'Amazon 999', 999, 'out', 'online')
c(6, 'Flipkart 1299', 1299, 'out', 'online')
c(6, 'Myntra 1800', 1800, 'out', 'shopping')
c(6, 'Netflix 649', 649, 'out', 'entertainment')
c(6, 'Spotify 119', 119, 'out', 'entertainment')
c(6, 'Jio recharge 299', 299, 'out', 'bills')
c(6, 'Airtel 399', 399, 'out', 'bills')
c(6, 'electricity bill 1200', 1200, 'out', 'bills')
c(6, 'rent 15000', 15000, 'out', 'rent')
c(6, 'petrol 500', 500, 'out', 'transport')
c(6, 'chai 20', 20, 'out', 'food')
c(6, 'doctor 600', 600, 'out', 'health')
c(6, 'medicine 340', 340, 'out', 'health')
c(6, "Domino's 600", 600, 'out', 'food')
c(6, "McDonald's 350", 350, 'out', 'food')
c(6, 'Book My Show 500', 500, 'out', 'entertainment')
c(6, 'Swiggy Instamart 600', 600, 'out', 'groceries')

// 7 Dates
c(7, '250 lunch yesterday', 250, 'out', 'food', { date: -1 })
c(7, 'kal 500 petrol', 500, 'out', 'transport', { date: -1 })
c(7, 'parso 1200 shopping', 1200, 'out', 'shopping', { date: -2 })
c(7, 'last Monday 800 groceries', 800, 'out', 'groceries', { date: { wd: 1, last: true } })
c(7, '300 dinner on the 3rd', 300, 'out', 'food', { date: { dom: 3 } })
c(7, 'day before yesterday 450 movie', 450, 'out', 'entertainment', { date: -2 })
c(7, 'kal raat 400 dinner', 400, 'out', 'food', { date: -1 })
c(7, 'yesterday night 600 dinner', 600, 'out', 'food', { date: -1 })
c(7, 'on Monday 200 metro', 200, 'out', 'transport', { date: { wd: 1 } })
c(7, 'two days ago 500 lunch', 500, 'out', 'food', { date: -2 })
c(7, 'on 3rd November 1500 shopping', 1500, 'out', 'shopping', { date: { md: [11, 3] } })
c(7, 'aaj 300 lunch', 300, 'out', 'food')

// 8 Accounts
c(8, '500 petrol by card', 500, 'out', 'transport', { acc: 'card' })
c(8, '250 lunch cash', 250, 'out', 'food', { acc: 'cash' })
c(8, '300 groceries UPI', 300, 'out', 'groceries', { acc: 'upi' })
c(8, '120 auto GPay', 120, 'out', 'transport', { acc: 'upi' })
c(8, '450 dinner PhonePe', 450, 'out', 'food', { acc: 'upi' })
c(8, '200 recharge Paytm', 200, 'out', 'bills', { acc: 'upi' })
c(8, '120 auto G Pay', 120, 'out', 'transport', { acc: 'upi', note: 'Auto' })
c(8, '450 dinner phone pe', 450, 'out', 'food', { acc: 'upi' })
c(8, '450 dinner Phone Pay', 450, 'out', 'food', { acc: 'upi' })
c(8, 'card se 1500 shopping', 1500, 'out', 'shopping', { acc: 'card' })
c(8, '1500 shopping debit card', 1500, 'out', 'shopping', { acc: 'card' })
c(8, 'paid 800 with credit card for shoes', 800, 'out', 'shopping', { acc: 'card' })
c(8, '500 Uber from my card', 500, 'out', 'transport', { acc: 'card' })
c(8, 'cash mein 90 chai', 90, 'out', 'food', { acc: 'cash' })

// 9 Money in (plus one out-going contrast)
c(9, 'got 2000 from Rahul', 2000, 'in', ['payment', 'people'])
c(9, 'salary 50000', 50000, 'in', 'salary')
c(9, 'Rahul ne 500 diye', 500, 'in', ['payment', 'people'])
c(9, 'refund 300', 300, 'in', 'return')
c(9, 'received 1500 from Priya', 1500, 'in', ['payment', 'people'])
c(9, 'Amazon refund 799', 799, 'in', 'return')
c(9, 'Mom sent 5000', 5000, 'in', ['people', 'payment'])
c(9, 'papa ne 2000 bheje', 2000, 'in', ['people', 'payment'])
c(9, 'Rahul paid me 400', 400, 'in', ['payment', 'people'])
c(9, 'got back 1200 from Meera', 1200, 'in', ['payment', 'people'])
c(9, 'Rahul gave 500', 500, 'in', ['payment', 'people'])
c(9, 'Diwali bonus 10000', 10000, 'in', ['salary', 'payment', 'other'])
c(9, 'sold my old cycle for 3000', 3000, 'in', ['other', 'payment', 'return', null])
c(9, 'freelance payment 15000', 15000, 'in', ['payment', 'salary'])
c(9, 'Rahul ko 500 diye', 500, 'out', ['people', 'other', null])

// 10 Recognizer slips
c(10, 'to 50 lunch', 250, 'out', 'food', { held: 'to, for and won are trusted only when another alternative agrees' })
c(10, '2 50 lunch', 250, 'out', 'food')
c(10, '250 launch', 250, 'out', 'food')
c(10, 'for 50 tea', 450, 'out', 'food', { held: 'to, for and won are trusted only when another alternative agrees' })
c(10, 'won 20 rupees', 120, 'out', null, { held: 'to, for and won are trusted only when another alternative agrees' })
c(10, '100 and 50', 150, 'out', null)
c(10, 'two 50 lunch', 250, 'out', 'food')
c(10, 'Rs 2 50 lunch', 250, 'out', 'food')
c(10, 'to fifty lunch', 250, 'out', 'food', { held: 'to, for and won are trusted only when another alternative agrees' })
c(10, '1 50 coffee', 150, 'out', 'food')
c(10, 'got 50 cash back', 50, 'in', 'return')
c(10, '2:50 lunch', 250, 'out', 'food') // "two fifty" formatted as a time
c(10, '2.50 lunch', 250, 'out', 'food', { amb: 'as text it is ₹2.50; only the context says 250' })

// 11 Trip payer (people: you, Aarav, Rahul, Meera, Karan)
c(11, 'Rahul paid 800 cab', 800, 'out', 'transport', { payer: 'rahul' })
c(11, '800 cab paid by Rahul', 800, 'out', 'transport', { payer: 'rahul' })
c(11, 'Rahul ne 800 diye cab ke liye', 800, 'out', 'transport', { payer: 'rahul' })
c(11, 'Meera paid 1200 for dinner', 1200, 'out', 'food', { payer: 'meera' })
c(11, 'Aarav ne petrol ke 2000 bhare', 2000, 'out', 'transport', { payer: 'aarav' })
c(11, 'Karan has paid 450 for snacks', 450, 'out', 'food', { payer: 'karan' })
c(11, 'dinner 2400 Karan paid', 2400, 'out', 'food', { payer: 'karan' })
c(11, 'I paid 600 for tickets', 600, 'out', 'entertainment')
c(11, 'Meera ne dinner ke 1500 diye', 1500, 'out', 'food', { payer: 'meera' })
c(11, 'Karan ne pay kiya 900 lunch', 900, 'out', 'food', { payer: 'karan' })
c(11, 'Mira paid 1500 for dinner', 1500, 'out', 'food', { payer: 'meera' })
c(11, 'rahul paid 300 for chai', 300, 'out', 'food', { payer: 'rahul' })
c(11, 'cab 800 Rahul ne diya', 800, 'out', 'transport', { payer: 'rahul' })
c(11, 'Aarav paid for the cab 650', 650, 'out', 'transport', { payer: 'aarav' })
c(11, 'Rahul ne cab ka 800 pay kiya', 800, 'out', 'transport', { payer: 'rahul' })

// 12 Alternatives: Android gives the top result a confidence and the rest 0
a(12, [['to 50 lunch', 0.83], ['250 lunch', 0], ['two 50 lunch', 0], ['2 50 lunch', 0]], 250, 'out', 'food')
a(12, [['250 launch', 0.88], ['250 lunch', 0], ['250 launched', 0]], 250, 'out', 'food')
a(12, [['for 50 tea', 0.71], ['450 tea', 0], ['for fifty tea', 0], ['4 50 tea', 0]], 450, 'out', 'food')
a(12, [['die so ka petrol', 0.55], ['dhai sau ka petrol', 0], ['dhaai sau ka petrol', 0]], 250, 'out', 'transport')
a(12, [['Swiggy 340', 0.91], ['swiggy 340', 0], ['Swiggy three forty', 0]], 340, 'out', 'food')
a(12, [['got 2000 from Rahul', 0.86], ['got 2000 from Raul', 0], ['got 2,000 from Rahul', 0]], 2000, 'in', ['payment', 'people'])
a(12, [['1200 electricity bill by card', 0.9], ['1200 electricity bill by cart', 0], ['1200 electricity bill buy card', 0]], 1200, 'out', 'bills', { acc: 'card' })
a(12, [['200 shoe polish', 0.8], ['200 show polish', 0], ['200 shoes polish', 0]], 200, 'out', ['shopping', 'other', 'groceries', null])
a(12, [['1 lakh 20 thousand rent', 0.8], ['1 lakh 20000 rent', 0], ['one lakh twenty thousand rent', 0], ['1.2 lakh rent', 0]], 120000, 'out', 'rent')
a(12, [['teen so pachas ka petrol', 0.6], ['teen sau pachas ka petrol', 0], ['3 so 50 ka petrol', 0]], 350, 'out', 'transport')

// 13 Probes: transcripts that are right, phrased the way people talk
c(13, 'groceries 800 from DMart', 800, 'out', 'groceries')
c(13, 'medicine 340 from Apollo', 340, 'out', 'health')
c(13, '300 lunch from the canteen', 300, 'out', 'food')
c(13, 'maid salary 3000', 3000, 'out', ['people', 'other', 'bills', null])
c(13, 'bus 40 to sector 62', 40, 'out', 'transport')
c(13, 'paid 50 for 100 photocopies', 50, 'out', ['other', 'shopping', null])
c(13, 'bijli ka bill aaya 1200', 1200, 'out', 'bills')
c(13, 'Swiggy se khana aaya 450', 450, 'out', 'food')
c(13, 'returned 500 to Rahul', 500, 'out', ['people', 'other', null])
c(13, 'Rahul ko 500 wapas diye', 500, 'out', ['people', 'other', null])
c(13, 'credit card bill 5000', 5000, 'out', 'bills')
c(13, 'birthday card 150', 150, 'out', ['shopping', 'other', null])
c(13, 'got 2 coffees for 300', 300, 'out', 'food')
c(13, '450 at R K Stores', 450, 'out', ['groceries', 'shopping', 'other', null])
c(13, 'auto 80 to CR Park', 80, 'out', 'transport')
c(13, 'chai 20 on the 25th', 20, 'out', 'food', { date: { dom: 25 } })
c(13, 'return cab 300', 300, 'out', 'transport')
c(13, 'Uber 230 from office', 230, 'out', 'transport')

// ---- fresh phrasings for 2.13.1, written before the fixes (fresh: the cause in the brief they check)
const f = (n, x = {}) => ({ ...x, fresh: n })
// 1 amounts said in pieces; to/for/won only when another alternative agrees; no false joins
c(10, '3 50 auto', 350, 'out', 'transport', f(1))
c(10, 'six 40 groceries', 640, 'out', 'groceries', f(1))
c(10, '200 and 50 parking', 250, 'out', 'transport', f(1))
a(12, [['for 99 chips', 0.74], ['499 chips', 0], ['for ninety nine chips', 0]], 499, 'out', [null, 'food', 'groceries'], f(1))
a(12, [['won 80 parking', 0.69], ['one 80 parking', 0], ['180 parking', 0]], 180, 'out', 'transport', f(1))
c(1, '3 samosas 45', 45, 'out', 'food', f(1))
c(1, 'dinner at 9:30 650', 650, 'out', 'food', f(1))
// 2 spending or income
c(13, 'vegetables 120 from the market', 120, 'out', 'groceries', f(2))
c(13, 'sweets 400 from Haldiram', 400, 'out', 'food', f(2))
c(13, 'Uber 180 from the airport', 180, 'out', 'transport', f(2))
c(9, 'Bhaiya ne 1000 bheje', 1000, 'in', ['people', 'payment'], f(2))
c(9, 'Neha sent 1500', 1500, 'in', ['payment', 'people'], f(2))
c(9, 'nani ne 2000 diye', 2000, 'in', ['payment', 'people'], f(2))
c(9, 'sold old phone for 8000', 8000, 'in', ['other', 'payment', 'return', null], f(2))
c(9, 'performance bonus 25000', 25000, 'in', ['salary', 'payment', 'other'], f(2))
c(13, 'returned 300 to Amit', 300, 'out', ['people', 'other', null], f(2))
c(13, 'Amit ko 300 wapas kar diye', 300, 'out', ['people', 'other', null], f(2))
c(13, 'driver salary 12000', 12000, 'out', ['people', 'other', 'bills', 'transport', null], f(2))
// 3 shop and tag words
c(6, 'Domino’s 450', 450, 'out', 'food', f(3))
c(6, 'Mcdonald’s 199', 199, 'out', 'food', f(3))
c(6, 'Pharm Easy 450', 450, 'out', 'health', f(3))
c(6, 'Jio Mart 900', 900, 'out', 'groceries', f(3))
c(6, 'Amazon Prime 1499', 1499, 'out', 'entertainment', f(3))
c(10, 'cash back 75 on Amazon', 75, 'in', 'return', f(3))
c(10, 'office launch 180', 180, 'out', 'food', f(3))
c(10, 'launch 120 canteen', 120, 'out', 'food', f(3))
// 4 Hindi numbers in Latin letters
c(4, 'chalees rupaye ki chai', 40, 'out', 'food', f(4))
c(4, 'pachattar rupaye ka auto', 75, 'out', 'transport', f(4))
c(4, 'Rahul ke saath dinner 900', 900, 'out', 'food', f(4))
c(4, 'sabzi saath rupaye', 60, 'out', 'groceries', f(4))
c(4, 'paanch so ka recharge', 500, 'out', 'bills', f(4))
c(3, 'three and a half thousand electricity bill', 3500, 'out', 'bills', f(4))
c(3, 'school fees 1 lakh 50', 150000, 'out', [null, 'other', 'bills'], f(4))
// 5 accounts
c(8, '200 parking by G pay', 200, 'out', 'transport', f(5, { acc: 'upi' }))
c(8, '350 medicine Phone pay se', 350, 'out', 'health', f(5, { acc: 'upi' }))
c(8, 'petrol 1000 debit card se', 1000, 'out', 'transport', f(5, { acc: 'card' }))
c(8, '900 groceries from my debit card', 900, 'out', 'groceries', f(5, { acc: 'card' }))
c(8, 'lunch 300 credit card se', 300, 'out', 'food', f(5, { acc: 'card' }))
// 6 dates
c(7, 'petrol 800 on the 1st', 800, 'out', 'transport', f(6, { date: { dom: 1 } }))
c(7, 'November 5th 2400 groceries', 2400, 'out', 'groceries', f(6, { date: { md: [11, 5] } }))
c(7, '4 days ago 350 movie', 350, 'out', 'entertainment', f(6, { date: -4 }))
c(7, 'on the 30th 650 dinner', 650, 'out', 'food', f(6, { date: { dom: 30 } }))
c(7, 'teen din pehle 200 auto', 200, 'out', 'transport', f(6, { date: -3 }))
// 7 numbers that aren't prices
c(13, 'maintenance 1500 for flat 2304', 1500, 'out', 'bills', f(7))
c(13, 'bus 25 route 522', 25, 'out', 'transport', f(7))
c(13, 'auto 70 from block 128', 70, 'out', 'transport', f(7))
c(13, 'paid 40 for 80 pages printout', 40, 'out', [null, 'other', 'shopping'], f(7))
c(7, 'lunch 120 on the 28th', 120, 'out', 'food', f(7, { date: { dom: 28 } }))
// 8 a tag's name said as a plain word
c(1, 'tickets for 2 people 500', 500, 'out', 'entertainment', f(8))
c(6, 'return flight 4500', 4500, 'out', 'transport', f(8))
c(6, 'paid online 600 for wifi', 600, 'out', 'bills', f(8))
// added after "paid online 600 for wifi" failed on the first run and was fixed (so that one is no longer untuned)
c(6, 'recharge 299 online', 299, 'out', 'bills', f(8))
c(6, 'online movie tickets 300', 300, 'out', 'entertainment', f(8))
// 9 ranking: a tag found in another alternative doesn't outvote the recognizer, or a different amount
a(12, [['60 photocopy', 0.85], ['60 photo copy', 0], ['60 photo coffee', 0]], 60, 'out', [null, 'other', 'shopping'], f(9))
a(12, [['40 key chain', 0.83], ['40 key chai', 0], ['40 keychain', 0]], 40, 'out', [null, 'shopping', 'other'], f(9))
a(12, [['500 tailor', 0.9], ['50 tailor lunch', 0]], 500, 'out', [null, 'shopping', 'other'], f(9))
// 10 trip payer (people: you, Aarav, Rahul, Meera, Karan)
c(11, 'Arav paid 700 for petrol', 700, 'out', 'transport', f(10, { payer: 'aarav' }))
c(11, 'Meera ne lunch ka 900 pay kiya', 900, 'out', 'food', f(10, { payer: 'meera' }))
c(11, 'Karan ne snacks ke 450 pay kar diye', 450, 'out', 'food', f(10, { payer: 'karan' }))
c(11, 'Kiran paid 300 for chai', 300, 'out', 'food', f(10))
// 11 K and CR only right after a number
c(13, '350 at A K Stores', 350, 'out', [null, 'groceries', 'shopping', 'other'], f(11))
c(13, 'dinner at CR Park 1200', 1200, 'out', 'food', f(11))
c(13, 'cab 300 to K R Puram', 300, 'out', 'transport', f(11))
// 12 Devanagari
c(5, 'चाय 30', 30, 'out', 'food', f(12))
c(5, 'कल 400 का खाना', 400, 'out', 'food', f(12, { date: -1 }))
c(5, 'बिजली का बिल 1500', 1500, 'out', 'bills', f(12))
c(5, 'पचास रुपये का पेट्रोल', 50, 'out', 'transport', f(12))
// 13 leftover fragments in notes
c(8, '80 chai G pay', 80, 'out', 'food', f(13, { acc: 'upi', note: 'Chai' }))
c(7, '300 dinner on the 3rd', 300, 'out', 'food', f(13, { date: { dom: 3 }, note: 'Dinner' }))
c(10, '2 50 lunch', 250, 'out', 'food', f(13, { note: 'Lunch' }))

// 14 What Google's recognizer wrote (Chrome's Web Speech API, en-IN unless Devanagari = hi-IN) for Windows'
// en-US voices saying amounts the Indian way, from the 2.13.2 hearing check. Each one showed a misreading that
// was then fixed; the confidences are Chrome's, 0 for every reading. The headline rate leaves this group out.
a(14, [['Amazon 999', 0], ['Amazon 9999', 0], ['Amazon Rs 999', 0], ['Amazon $99', 0]], 999, 'out', 'online')
a(14, [['Amazon 999', 0], ['Amazon 9999', 0]], 999, 'out', 'online')
a(14, [['999 shoes', 0], ['9999 shoes', 0]], 999, 'out', 'shopping')
c(14, '250 Dinar', 250, 'out', 'food', { note: 'Dinner' })
c(14, '450 Dinar phonepe', 450, 'out', 'food', { acc: 'upi' })
c(14, '1.2 lock rent', 120000, 'out', 'rent')
c(14, 'one and half 1000 shopping', 1500, 'out', 'shopping')
c(14, 'two and a half 1000 groceries', 2500, 'out', 'groceries')
c(14, 'receive 1500 from Priya', 1500, 'in', ['payment', 'people'], { note: 'Priya' })
c(14, '250 लंच', 250, 'out', 'food')
c(14, '2-50 लंच', 250, 'out', 'food')
c(14, '1500 ग्रोसरीज', 1500, 'out', 'groceries')
c(14, '1-500 ग्रोसरीज', 1500, 'out', 'groceries')
c(14, '100-0 शॉपिंग', 1000, 'out', 'shopping')
c(14, 'जोमैटो 450', 450, 'out', 'food')
c(14, '2000 फ्रॉम राहुल', 2000, 'in', ['payment', 'people'])
// and the formats it used that already read right: currency signs, "K" after a space, a time for a price
c(14, '$499 Netflix', 499, 'out', 'entertainment')
c(14, '€150', 150, 'out', null)
c(14, '2.5 K shopping', 2500, 'out', 'shopping')
c(14, 'Uber 2:30', 230, 'out', 'transport')
c(14, 'one and half thousand shopping', 1500, 'out', 'shopping')

// ---- the 18 phrases of trip-e2e.mjs's "--- parser" section, checked the way it checks them: tripPayer with
// these people, then parseSpeech; payer, amount (minor), tag and kind must match exactly
export const TRIP_E2E_PEOPLE = [{ id: 'me', name: 'Jatin' }, { id: 'r', name: 'Rahul' }, { id: 'm', name: 'Meera Shah' }, { id: 'k', name: 'Karan' }]
export const TRIP_E2E = [
  ['Rahul paid 800 cab', 'r', 80000, 'transport', 'out'],
  ['rahul paid 800 for the cab', 'r', 80000, 'transport', 'out'],
  ['800 cab paid by Rahul', 'r', 80000, 'transport', 'out'],
  ['cab 800 Rahul paid', 'r', 80000, 'transport', 'out'],
  ['Rahul ne 800 diye cab ke liye', 'r', 80000, 'transport', 'out'],
  ['Rahul ne cab ke 800 diye', 'r', 80000, 'transport', 'out'],
  ['Meera paid 1200 dinner', 'm', 120000, 'food', 'out'],
  ['Meera Shah paid 1200 dinner', 'm', 120000, 'food', 'out'],
  ['Karan has paid 300 chai', 'k', 30000, 'food', 'out'],
  ['Karan ne pay kiya 450 lunch', 'k', 45000, 'food', 'out'],
  ['250 shopping', null, 25000, 'shopping', 'out'],
  ['dhai sau ka khana kal', null, 25000, 'food', 'out'],
  ['800 dinner with Rahul', null, 80000, 'food', 'out'],
  ['uber 340 kal', null, 34000, 'transport', 'out'],
  ['paid 1200 electricity bill by card', null, 120000, 'bills', 'out'],
  ['got 2000 from Rahul', null, 200000, 'payment', 'in'],
  ['Rahul gave me 500', null, 50000, 'payment', 'in'],
  ['karanataka hotel 2000', null, 200000, null, 'out']
]

export { cases }
