export type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

export type PaidShare = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string
}

type BillList = { bills: Bill[] }

const REQUEST_TIMEOUT_MS = 15_000

export async function getHomeBills(homeId: string): Promise<Bill[]> {
  const result = await requestJson(`/api/homes/${encodeURIComponent(homeId)}/bills`)
  if (!isBillList(result)) {
    throw new Error('The server returned an invalid bills response')
  }
  return result.bills
}

export async function payShare(
  billId: string,
  shareId: string,
  idempotencyKey: string,
): Promise<PaidShare> {
  const result = await requestJson(
    `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  )

  if (!isPaidShare(result)) {
    throw new Error('The server returned an invalid payment response')
  }
  return result
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    let body: unknown

    try {
      body = await response.json()
    } catch {
      if (controller.signal.aborted) {
        throw new Error('The request timed out. Please try again.')
      }
      if (!response.ok) {
        throw new Error(`The server returned an error (${response.status})`)
      }
      throw new Error('The server returned invalid JSON')
    }

    if (!response.ok) {
      if (isRecord(body) && typeof body.error === 'string') {
        throw new Error(body.error)
      }
      throw new Error(`The server returned an error (${response.status})`)
    }

    return body
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('The request timed out. Please try again.')
    }
    if (error instanceof Error) {
      throw error
    }
    throw new Error('The request failed. Please try again.')
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function isBillList(value: unknown): value is BillList {
  if (!isRecord(value) || !Array.isArray(value.bills)) {
    return false
  }

  return value.bills.every(
    (bill) =>
      isRecord(bill) &&
      typeof bill.id === 'string' &&
      typeof bill.homeId === 'string' &&
      typeof bill.title === 'string' &&
      Number.isSafeInteger(bill.totalCents) &&
      Array.isArray(bill.shares) &&
      bill.shares.every(
        (share) =>
          isRecord(share) &&
          typeof share.id === 'string' &&
          typeof share.memberId === 'string' &&
          typeof share.memberName === 'string' &&
          Number.isSafeInteger(share.amountCents) &&
          (typeof share.paidAt === 'string' || share.paidAt === null),
      ),
  )
}

function isPaidShare(value: unknown): value is PaidShare {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.memberId === 'string' &&
    Number.isSafeInteger(value.amountCents) &&
    typeof value.paidAt === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
