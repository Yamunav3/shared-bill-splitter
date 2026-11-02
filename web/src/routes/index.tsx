import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useRef, useState } from 'react'
import { type Bill, getHomeBills, payShare } from '../api'
import '../styles.css'

export const Route = createFileRoute('/')({
  component: Home,
})

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function Home() {
  const [homeIdInput, setHomeIdInput] = useState('')
  const [activeHomeId, setActiveHomeId] = useState<string | null>(null)
  const [bills, setBills] = useState<Bill[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [pendingShareId, setPendingShareId] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({})
  const paymentKeys = useRef(new Map<string, string>())

  async function loadHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const homeId = homeIdInput.trim()
    if (homeId.length === 0) {
      setPageError('Enter a home ID to load its bills.')
      return
    }

    setActiveHomeId(homeId)
    setBills(null)
    setPageError(null)
    setNotice(null)
    setPaymentErrors({})
    setIsLoading(true)

    try {
      setBills(await getHomeBills(homeId))
    } catch (error) {
      setPageError(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function handlePay(billId: string, shareId: string) {
    const key = paymentKeys.current.get(shareId) ?? crypto.randomUUID()
    paymentKeys.current.set(shareId, key)
    setPendingShareId(shareId)
    setNotice(null)
    setPaymentErrors((current) => {
      const next = { ...current }
      delete next[shareId]
      return next
    })

    try {
      const payment = await payShare(billId, shareId, key)
      setBills(
        (currentBills) =>
          currentBills?.map((bill) =>
            bill.id === billId
              ? {
                  ...bill,
                  shares: bill.shares.map((share) =>
                    share.id === payment.id ? { ...share, paidAt: payment.paidAt } : share,
                  ),
                }
              : bill,
          ) ?? null,
      )
      paymentKeys.current.delete(shareId)
      setNotice('Payment confirmed. The share is now marked as paid.')
    } catch (error) {
      setPaymentErrors((current) => ({ ...current, [shareId]: errorMessage(error) }))
    } finally {
      setPendingShareId(null)
    }
  }

  return (
    <main className="app-shell">
      <header className="page-heading">
        <div className="brand-mark" aria-hidden="true">
          SB
        </div>
        <p className="eyebrow">Shared home expenses</p>
        <h1>Bill Splitter</h1>
        <p className="intro">See what’s been shared and mark your part as paid.</p>
      </header>

      <section className="home-panel" aria-labelledby="home-title">
        <div>
          <h2 id="home-title">Choose a home</h2>
          <p>Enter the ID of the home whose bills you want to view.</p>
        </div>
        <form className="home-form" onSubmit={loadHome}>
          <label htmlFor="home-id">Home ID</label>
          <div className="home-form-row">
            <input
              autoComplete="off"
              id="home-id"
              onChange={(event) => setHomeIdInput(event.currentTarget.value)}
              placeholder="Paste a home ID"
              value={homeIdInput}
            />
            <button
              className="primary-button"
              disabled={isLoading || pendingShareId !== null}
              type="submit"
            >
              {isLoading ? 'Loading…' : activeHomeId === null ? 'Load bills' : 'Refresh bills'}
            </button>
          </div>
        </form>
      </section>

      {pageError !== null && (
        <p className="message error-message" role="alert">
          {pageError}
        </p>
      )}
      {notice !== null && (
        <p className="message success-message" role="status">
          {notice}
        </p>
      )}

      {isLoading && (
        <p className="loading-message" role="status">
          Loading bills…
        </p>
      )}

      {activeHomeId !== null && !isLoading && bills !== null && bills.length === 0 && (
        <section className="empty-state" aria-live="polite">
          <span className="empty-icon" aria-hidden="true">
            ◷
          </span>
          <h2>No bills yet</h2>
          <p>This home doesn’t have any bills to show.</p>
        </section>
      )}

      {bills !== null && bills.length > 0 && (
        <section className="bill-section" aria-label="Bills for this home">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your household</p>
              <h2>Bills and shares</h2>
            </div>
            <span className="bill-count">
              {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
            </span>
          </div>

          <div className="bill-list">
            {bills.map((bill) => (
              <article className="bill-card" key={bill.id}>
                <header className="bill-heading">
                  <div>
                    <h3>{bill.title}</h3>
                    <p>{bill.shares.length} household shares</p>
                  </div>
                  <strong className="bill-total">{formatCents(bill.totalCents)}</strong>
                </header>

                {bill.shares.length === 0 ? (
                  <p className="no-shares">No shares are recorded for this bill.</p>
                ) : (
                  <ul className="share-list">
                    {bill.shares.map((share) => {
                      const isPaid = share.paidAt !== null
                      const isPending = pendingShareId === share.id
                      const paymentError = paymentErrors[share.id]

                      return (
                        <li className="share-row" key={share.id}>
                          <div className="member-avatar" aria-hidden="true">
                            {share.memberName.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="share-member">
                            <span className="member-name">{share.memberName}</span>
                            {paymentError !== undefined && (
                              <span className="share-error" role="alert">
                                {paymentError}
                              </span>
                            )}
                          </div>
                          <strong className="share-amount">{formatCents(share.amountCents)}</strong>
                          {isPaid ? (
                            <span className="paid-status">Paid</span>
                          ) : (
                            <button
                              className="pay-button"
                              disabled={pendingShareId !== null}
                              onClick={() => void handlePay(bill.id, share.id)}
                              type="button"
                            >
                              {isPending ? 'Paying…' : 'Pay share'}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="page-footer">
        Amounts are shown in dollars and stored as whole cents.
      </footer>
    </main>
  )
}

function formatCents(cents: number): string {
  return money.format(cents / 100)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
