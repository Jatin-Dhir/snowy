// The fictional demo month behind the store graphics and the promo video: a believable
// month of expenses, budgets, goals and loans. seed() runs inside the app page (it is
// serialised with toString(), so it must stay self-contained) and imports the app's own
// database modules through the Vite dev server.

/** Runs inside the page: fills the app with a believable month (all fictional). */
export async function seed() {
  const [{ db, DEFAULT_SETTINGS }, repo, loans, goals, rules] = await Promise.all([
    import('/src/db/db.ts'),
    import('/src/db/repo.ts'),
    import('/src/db/loans.ts'),
    import('/src/db/goals.ts'),
    import('/src/db/recurring.ts')
  ])
  // the app seeds its own accounts and tags on first run: let it finish
  for (let i = 0; i < 60 && (await db.categories.count()) === 0; i++) await new Promise((r) => setTimeout(r, 100))

  const now = new Date()
  const dom = now.getDate()
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  // a moment this month, `daysAgo` back (clamped to the 1st); today's entries never sit in the future
  const when = (daysAgo, hh, mm) => {
    const back = Math.min(daysAgo, dom - 1)
    const h = back === 0 ? Math.min(hh, Math.max(0, now.getHours() - 1)) : hh
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, mm)
    return { dateISO: iso(d), ts: d.getTime() }
  }
  const add = (daysAgo, hh, mm, rupees, categoryId, accountId, note, kind = 'out') =>
    repo.addTxn({ amountMinor: rupees * 100, currency: 'INR', categoryId, accountId, kind, note, ...when(daysAgo, hh, mm) })

  // ---- this month
  const thisMonth = [
    [25, 10, 0, 62000, 'salary', 'upi', 'Salary', 'in'],
    [25, 9, 30, 14000, 'rent', 'upi', 'Rent'],
    [22, 7, 15, 1200, 'health', 'upi', 'Gym'],
    [20, 11, 0, 799, 'bills', 'upi', 'Airtel Wi-Fi'],
    [17, 18, 40, 1840, 'bills', 'upi', 'Electricity bill'],
    [12, 9, 20, 299, 'bills', 'upi', 'Jio recharge'],
    [14, 21, 0, 199, 'entertainment', 'card', 'Netflix'],
    [19, 8, 0, 119, 'entertainment', 'card', 'Spotify'],
    [6, 20, 30, 520, 'entertainment', 'upi', 'Movie night'],
    [23, 17, 10, 600, 'health', 'upi', 'Dr. Mehta'],
    [13, 19, 5, 310, 'health', 'upi', 'Pharmacy'],
    [18, 15, 25, 2199, 'shopping', 'card', 'Running shoes'],
    [12, 16, 45, 1499, 'shopping', 'card', 'Myntra - kurta'],
    [7, 22, 10, 649, 'online', 'card', 'Amazon - phone case'],
    [15, 13, 0, 1800, 'people', 'card', 'Gift for Mom'],
    [16, 19, 30, 790, 'groceries', 'upi', 'Zepto'],
    [9, 19, 0, 438, 'groceries', 'upi', 'Zepto'],
    [6, 11, 30, 1260, 'groceries', 'card', 'BigBasket'],
    [3, 8, 45, 240, 'groceries', 'cash', 'Sabzi'],
    [11, 8, 40, 240, 'groceries', 'cash', 'Sabzi'],
    [1, 19, 20, 612, 'groceries', 'upi', 'Zepto'],
    [21, 10, 0, 1000, 'transport', 'card', 'Petrol'],
    [10, 10, 0, 1000, 'transport', 'card', 'Petrol'],
    [8, 8, 50, 156, 'transport', 'upi', 'Uber'],
    [3, 18, 10, 243, 'transport', 'upi', 'Uber'],
    [0, 9, 5, 187, 'transport', 'upi', 'Uber'],
    [0, 8, 30, 60, 'transport', 'upi', 'Metro'],
    [4, 8, 30, 60, 'transport', 'upi', 'Metro'],
    [7, 8, 30, 60, 'transport', 'upi', 'Metro'],
    [13, 8, 30, 60, 'transport', 'upi', 'Metro'],
    [5, 21, 15, 520, 'food', 'upi', 'Biryani with Ananya'],
    [4, 20, 40, 418, 'food', 'upi', 'Zomato'],
    [8, 16, 20, 260, 'food', 'card', 'Third Wave coffee'],
    [2, 13, 15, 180, 'food', 'cash', 'Office lunch'],
    [7, 13, 10, 180, 'food', 'cash', 'Office lunch'],
    [10, 13, 20, 180, 'food', 'cash', 'Office lunch'],
    [15, 13, 5, 180, 'food', 'cash', 'Office lunch'],
    [0, 20, 10, 349, 'food', 'upi', 'Swiggy dinner'],
    [0, 11, 15, 30, 'food', 'cash', 'Chai'],
    [1, 17, 0, 30, 'food', 'cash', 'Chai'],
    [3, 17, 10, 30, 'food', 'cash', 'Chai'],
    [6, 16, 50, 30, 'food', 'cash', 'Chai'],
    [9, 17, 5, 30, 'food', 'cash', 'Chai'],
    [11, 16, 55, 30, 'food', 'cash', 'Chai'],
    [24, 12, 0, 749, 'return', 'upi', 'Myntra refund', 'in'],
    [14, 21, 30, 500, 'payment', 'upi', 'Rahul paid back', 'in'],
    [20, 9, 0, 2000, 'savings', 'upi', 'Goa trip'],
    [9, 9, 10, 2500, 'savings', 'upi', 'Goa trip']
  ]
  for (const t of thisMonth) await add(...t)

  // ---- the five months before, same habits, a little different each time
  const habit = [
    [1, 14000, 'rent', 'Rent'], [3, 1200, 'health', 'Gym'], [5, 799, 'bills', 'Airtel Wi-Fi'], [8, 1900, 'bills', 'Electricity bill'],
    [10, 299, 'bills', 'Jio recharge'], [14, 199, 'entertainment', 'Netflix'], [4, 2400, 'groceries', 'Zepto'],
    [11, 1800, 'groceries', 'BigBasket'], [18, 2200, 'groceries', 'Zepto'], [25, 2000, 'groceries', 'Zepto'],
    [2, 420, 'food', 'Swiggy dinner'], [6, 650, 'food', 'Biryani'], [9, 380, 'food', 'Zomato'], [13, 520, 'food', 'Lunch'],
    [20, 610, 'food', 'Zomato'], [27, 450, 'food', 'Swiggy dinner'], [3, 1000, 'transport', 'Petrol'], [12, 860, 'transport', 'Uber'],
    [19, 1000, 'transport', 'Petrol'], [26, 640, 'transport', 'Uber'], [7, 3200, 'shopping', 'Myntra'], [21, 2400, 'shopping', 'Decathlon'],
    [15, 640, 'entertainment', 'Movie night'], [22, 780, 'health', 'Pharmacy'], [16, 1500, 'people', 'Gift'], [24, 3000, 'savings', 'Goa trip']
  ]
  const factors = [0.94, 1.0, 0.86, 1.04, 0.9]
  for (let m = 1; m <= 5; m++) {
    const at = (day, hh) => {
      const d = new Date(now.getFullYear(), now.getMonth() - m, Math.min(day, 28), hh, 0)
      return { dateISO: iso(d), ts: d.getTime() }
    }
    await repo.addTxn({ amountMinor: 6200000, currency: 'INR', categoryId: 'salary', accountId: 'upi', kind: 'in', note: 'Salary', ...at(1, 10) })
    for (const [day, rupees, cat, note] of habit) {
      const r = cat === 'rent' ? rupees : Math.round((rupees * factors[m - 1]) / 10) * 10
      await repo.addTxn({ amountMinor: r * 100, currency: 'INR', categoryId: cat, accountId: 'upi', note, ...at(day, 12) })
    }
  }

  await db.budgets.put({ id: 'overall', amountMinor: 5000000 })
  await db.budgets.put({ id: 'food', amountMinor: 600000 })
  await db.budgets.put({ id: 'groceries', amountMinor: 450000 })
  await db.budgets.put({ id: 'shopping', amountMinor: 450000 })

  const goa = await goals.addGoal('Goa trip', 2500000)
  await goals.addToGoal(goa.id, 950000)
  const phone = await goals.addGoal('New phone', 6000000)
  await goals.addToGoal(phone.id, 1800000)

  const soon = (days) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
  const loan = (direction, person, rupees, note, remindISO) =>
    loans.addLoan({ direction, person, amountMinor: rupees * 100, currency: 'INR', note, remindISO })
  await loan('lent', 'Rahul', 2000, 'Concert tickets', soon(4))
  await loan('lent', 'Meera', 1200, 'Cab share to the airport', soon(9))
  await loan('lent', 'Karan', 450, 'Lunch', null)
  await loan('borrowed', 'Ananya', 850, 'Split dinner', null)
  await loan('borrowed', 'Dad', 3000, 'Phone EMI', soon(12))
  // two already settled, so the sheet shows its history too
  for (const done of [await loan('lent', 'Neha', 600, 'Movie tickets', null), await loan('borrowed', 'Vikram', 1500, 'Trek deposit', null)]) {
    await loans.settleLoan(done.id)
  }

  await rules.addRule({ name: 'Rent', amountMinor: 1400000, categoryId: 'rent', dayOfMonth: 1 })
  await rules.addRule({ name: 'Netflix', amountMinor: 19900, categoryId: 'entertainment', dayOfMonth: 14 })

  await db.kv.put({
    key: 'settings',
    value: { ...DEFAULT_SETTINGS, initialized: true, currency: 'INR', theme: 'light', accent: 'blue', soundPack: 'pop', sounds: false, haptics: false }
  })
  localStorage.setItem('taily.voicehint.seen', '1')
  localStorage.setItem('taily.save.hidden', iso(now))
  return { txns: await db.txns.count() }
}
