import { type Context, Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const name = await readName(c.req.raw)
  if (name === null) {
    return c.json({ error: 'Name must be a non-empty string' }, 400)
  }

  const id = crypto.randomUUID()

  try {
    await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
    return c.json({ id, name }, 201)
  } catch {
    return c.json({ error: 'Unable to create home' }, 500)
  }
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  if (homeId.trim().length === 0) {
    return c.json({ error: 'Invalid home ID' }, 400)
  }

  const name = await readName(c.req.raw)
  if (name === null) {
    return c.json({ error: 'Name must be a non-empty string' }, 400)
  }

  try {
    const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
      .bind(homeId)
      .first<{ id: string }>()

    if (home === null) {
      return c.json({ error: 'Home not found' }, 404)
    }

    const id = crypto.randomUUID()
    await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
      .bind(id, homeId, name)
      .run()

    return c.json({ id, homeId, name }, 201)
  } catch {
    return c.json({ error: 'Unable to create member' }, 500)
  }
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  if (homeId.trim().length === 0) {
    return c.json({ error: 'Invalid home ID' }, 400)
  }

  const body = await readJsonObject(c.req.raw)
  if (body === null) {
    return c.json({ error: 'Request body must be a JSON object' }, 400)
  }

  const title = body.title
  if (typeof title !== 'string' || title.trim().length === 0) {
    return c.json({ error: 'Title must be a non-empty string' }, 400)
  }

  const totalCents = body.totalCents
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive whole number' }, 422)
  }

  try {
    const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
      .bind(homeId)
      .first<{ id: string }>()

    if (home === null) {
      return c.json({ error: 'Home not found' }, 404)
    }

    const members = await c.env.DB.prepare(
      'SELECT id FROM members WHERE home_id = ? ORDER BY created_order ASC',
    )
      .bind(homeId)
      .all<{ id: string }>()

    if (members.results.length === 0) {
      return c.json({ error: 'Home has no members' }, 422)
    }

    const billId = crypto.randomUUID()
    const normalizedTitle = title.trim()
    const shareBase = Math.floor(totalCents / members.results.length)
    const remainder = totalCents % members.results.length
    const shares = members.results.map((member, index) => ({
      id: crypto.randomUUID(),
      memberId: member.id,
      amountCents: shareBase + (index < remainder ? 1 : 0),
      paidAt: null,
    }))

    const statements = [
      c.env.DB.prepare(
        'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
      ).bind(billId, homeId, normalizedTitle, totalCents),
      ...shares.map((share) =>
        c.env.DB.prepare(
          'INSERT INTO shares (id, home_id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
        ).bind(share.id, homeId, billId, share.memberId, share.amountCents),
      ),
    ]

    await c.env.DB.batch(statements)

    return c.json({ id: billId, homeId, title: normalizedTitle, totalCents, shares }, 201)
  } catch {
    return c.json({ error: 'Unable to create bill' }, 500)
  }
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  if (homeId.trim().length === 0) {
    return c.json({ error: 'Invalid home ID' }, 400)
  }

  try {
    const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
      .bind(homeId)
      .first<{ id: string }>()

    if (home === null) {
      return c.json({ error: 'Home not found' }, 404)
    }

    const rows = await c.env.DB.prepare(
      `SELECT
         bills.id AS billId,
         bills.home_id AS homeId,
         bills.title,
         bills.total_cents AS totalCents,
         shares.id AS shareId,
         shares.member_id AS memberId,
         members.name AS memberName,
         shares.amount_cents AS amountCents,
         shares.paid_at AS paidAt
       FROM bills
       LEFT JOIN shares ON shares.bill_id = bills.id
       LEFT JOIN members
         ON members.id = shares.member_id
         AND members.home_id = bills.home_id
       WHERE bills.home_id = ?
       ORDER BY bills.rowid ASC, members.created_order ASC`,
    )
      .bind(homeId)
      .all<HomeBillRow>()

    const bills = new Map<string, HomeBill>()
    for (const row of rows.results) {
      let bill = bills.get(row.billId)
      if (bill === undefined) {
        bill = {
          id: row.billId,
          homeId: row.homeId,
          title: row.title,
          totalCents: row.totalCents,
          shares: [],
        }
        bills.set(row.billId, bill)
      }

      if (
        row.shareId !== null &&
        row.memberId !== null &&
        row.memberName !== null &&
        row.amountCents !== null
      ) {
        bill.shares.push({
          id: row.shareId,
          memberId: row.memberId,
          memberName: row.memberName,
          amountCents: row.amountCents,
          paidAt: row.paidAt,
        })
      }
    }

    return c.json({ bills: [...bills.values()] }, 200)
  } catch {
    return c.json({ error: 'Unable to get home bills' }, 500)
  }
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const rawIdempotencyKey = c.req.header('Idempotency-Key')
  const idempotencyKey = rawIdempotencyKey?.trim()

  if (idempotencyKey === undefined || idempotencyKey.length === 0 || idempotencyKey.length > 255) {
    return c.json({ error: 'A valid Idempotency-Key header is required' }, 400)
  }

  try {
    const current = await findSharePayment(c.env.DB, billId, shareId)
    if (current === null) {
      return c.json({ error: 'Bill or share not found' }, 404)
    }

    const decision = decidePayment(current, idempotencyKey)
    if (decision.kind === 'already-paid') {
      return c.json(decision.payment, 200)
    }
    if (decision.kind === 'conflict') {
      return c.json({ error: 'Share has already been paid' }, 409)
    }

    const paidAt = new Date().toISOString()
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE shares SET paid_at = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
      ).bind(paidAt, shareId, billId),
      c.env.DB.prepare(
        `INSERT INTO share_payments (share_id, idempotency_key, paid_at)
         SELECT ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM shares WHERE id = ? AND bill_id = ? AND paid_at = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM share_payments WHERE share_id = ?
         )`,
      ).bind(shareId, idempotencyKey, paidAt, shareId, billId, paidAt, shareId),
    ])

    if (results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1) {
      return c.json(
        {
          id: current.id,
          memberId: current.memberId,
          amountCents: current.amountCents,
          paidAt,
        },
        200,
      )
    }

    return await resolvePaymentRace(c, billId, shareId, idempotencyKey)
  } catch {
    try {
      return await resolvePaymentRace(c, billId, shareId, idempotencyKey)
    } catch {
      return c.json({ error: 'Unable to process payment' }, 500)
    }
  }
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  if (homeId.trim().length === 0) {
    return c.json({ error: 'Invalid home ID' }, 400)
  }

  try {
    const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
      .bind(homeId)
      .first<{ id: string }>()

    if (home === null) {
      return c.json({ error: 'Home not found' }, 404)
    }

    const balances = await c.env.DB.prepare(
      `SELECT
         members.id AS memberId,
         members.name,
         COALESCE(SUM(shares.amount_cents), 0) AS outstandingCents
       FROM members
       LEFT JOIN shares
         ON shares.member_id = members.id
         AND shares.home_id = members.home_id
         AND shares.paid_at IS NULL
       WHERE members.home_id = ?
       GROUP BY members.id, members.name, members.created_order
       ORDER BY members.created_order ASC`,
    )
      .bind(homeId)
      .all<{ memberId: string; name: string; outstandingCents: number }>()

    return c.json({ balances: balances.results }, 200)
  } catch {
    return c.json({ error: 'Unable to get home balances' }, 500)
  }
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((_error, c) => c.json({ error: 'Internal server error' }, 500))

export default app

async function readName(request: Request): Promise<string | null> {
  const body = await readJsonObject(request)
  if (body === null) {
    return null
  }

  const name = body.name
  if (typeof name !== 'string' || name.trim().length === 0) {
    return null
  }

  return name.trim()
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null
    }

    return body as Record<string, unknown>
  } catch {
    return null
  }
}

type SharePaymentRecord = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
  idempotencyKey: string | null
  paymentPaidAt: string | null
}

type HomeBillRow = {
  billId: string
  homeId: string
  title: string
  totalCents: number
  shareId: string | null
  memberId: string | null
  memberName: string | null
  amountCents: number | null
  paidAt: string | null
}

type HomeBill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: {
    id: string
    memberId: string
    memberName: string
    amountCents: number
    paidAt: string | null
  }[]
}

type PaymentDecision =
  | {
      kind: 'already-paid'
      payment: { id: string; memberId: string; amountCents: number; paidAt: string }
    }
  | { kind: 'conflict' }
  | { kind: 'unpaid' }

async function findSharePayment(
  db: D1Database,
  billId: string,
  shareId: string,
): Promise<SharePaymentRecord | null> {
  return db
    .prepare(
      `SELECT
         shares.id,
         shares.member_id AS memberId,
         shares.amount_cents AS amountCents,
         shares.paid_at AS paidAt,
         share_payments.idempotency_key AS idempotencyKey,
         share_payments.paid_at AS paymentPaidAt
       FROM bills
       INNER JOIN shares ON shares.bill_id = bills.id
       LEFT JOIN share_payments ON share_payments.share_id = shares.id
       WHERE bills.id = ? AND shares.id = ?`,
    )
    .bind(billId, shareId)
    .first<SharePaymentRecord>()
}

function decidePayment(record: SharePaymentRecord, idempotencyKey: string): PaymentDecision {
  if (record.idempotencyKey !== null) {
    if (record.idempotencyKey === idempotencyKey && record.paymentPaidAt !== null) {
      return {
        kind: 'already-paid',
        payment: {
          id: record.id,
          memberId: record.memberId,
          amountCents: record.amountCents,
          paidAt: record.paymentPaidAt,
        },
      }
    }

    return { kind: 'conflict' }
  }

  if (record.paidAt !== null) {
    return { kind: 'conflict' }
  }

  return { kind: 'unpaid' }
}

async function resolvePaymentRace(
  c: Context<{ Bindings: Env }>,
  billId: string,
  shareId: string,
  idempotencyKey: string,
): Promise<Response> {
  const current = await findSharePayment(c.env.DB, billId, shareId)
  if (current === null) {
    return c.json({ error: 'Bill or share not found' }, 404)
  }

  const decision = decidePayment(current, idempotencyKey)
  if (decision.kind === 'already-paid') {
    return c.json(decision.payment, 200)
  }
  if (decision.kind === 'conflict') {
    return c.json({ error: 'Share has already been paid' }, 409)
  }

  return c.json({ error: 'Unable to process payment' }, 500)
}
