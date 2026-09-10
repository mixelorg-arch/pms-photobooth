/* Sales — cash actually received, what is still owed, and where it comes from. */

import { store, PAY_METHODS } from '../store.js';
import {
  el, money, compact, num, sum, sortBy, groupBy, matches, todayISO, toISO, fmtDate,
  titleCase, MONTHS_SHORT, toCSV, downloadText,
} from '../util.js';
import {
  table, panel, stat, bars, segment, search, button, tag, statusTag, twoLine, toast, fail, stickerCluster,
} from '../ui.js';
import { editBooking } from './scheduling.js';

const state = { period: 'month', q: '', method: 'all' };

const rerender = () => window.dispatchEvent(new CustomEvent('pms:rerender'));

function range(period) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (period === 'month')  return [toISO(new Date(y, m, 1)), toISO(new Date(y, m + 1, 0)), 'This month'];
  if (period === 'last')   return [toISO(new Date(y, m - 1, 1)), toISO(new Date(y, m, 0)), 'Last month'];
  if (period === 'quarter') {
    const q = Math.floor(m / 3) * 3;
    return [toISO(new Date(y, q, 1)), toISO(new Date(y, q + 3, 0)), 'This quarter'];
  }
  if (period === 'year')   return [toISO(new Date(y, 0, 1)), toISO(new Date(y, 11, 31)), 'This year'];
  return ['0000-01-01', '9999-12-31', 'All time'];
}

export default {
  id: 'sales',
  label: 'Sales',

  render(root) {
    const cur = store.currency;
    const [from, to, periodLabel] = range(state.period);

    const inPeriod = store.payments.filter((p) => p.paid_on >= from && p.paid_on <= to);
    const collected = sum(inPeriod, (p) => p.amount);
    const refunds = sum(inPeriod.filter((p) => p.kind === 'refund'), (p) => p.amount);

    const eventsInPeriod = store.bookings.filter(
      (b) => b.status !== 'cancelled' && b.event_date >= from && b.event_date <= to);
    const booked = sum(eventsInPeriod, (b) => num(b.total_amount));

    const receivables = store.bookingViews()
      .filter((b) => b.status !== 'cancelled' && b.balance_due > 0.005);
    const outstanding = sum(receivables, (b) => b.balance_due);

    const settledEvents = store.bookings.filter((b) => b.status === 'completed');
    const avgValue = settledEvents.length
      ? sum(settledEvents, (b) => num(b.total_amount)) / settledEvents.length : 0;

    /* ledger rows */
    const ledger = sortBy(inPeriod, (p) => p.paid_on, -1)
      .map((p) => {
        const b = store.booking(p.booking_id);
        const v = b ? store.view(b) : null;
        // Keep the payment's own reference distinct from the booking reference.
        return { ...p, booking: b, pay_ref: p.reference || '',
                 client_name: v?.client_name || 'Unlinked', reference: b?.reference || '—' };
      })
      .filter((p) => (state.method === 'all' || p.method === state.method) &&
        matches(state.q, p.client_name, p.reference, p.pay_ref, p.notes, p.method));

    /* revenue by package (cash allocated to the booking's package) */
    const byPackage = [...groupBy(
      inPeriod.map((p) => {
        const b = store.booking(p.booking_id);
        return { amount: p.amount, name: b ? (store.package(b.package_id)?.name || 'Custom') : 'Unlinked' };
      }), (r) => r.name)]
      .map(([name, rows]) => ({ label: name, value: sum(rows, (r) => r.amount) }));

    const byMethod = [...groupBy(inPeriod, (p) => p.method)]
      .map(([m, rows]) => ({ label: titleCase(m), value: sum(rows, (r) => r.amount) }));

    const months = store.monthlyRevenue(12).map((m) => ({
      label: `${MONTHS_SHORT[m.date.getMonth()]} ${String(m.date.getFullYear()).slice(2)}`,
      value: m.total,
    }));

    root.appendChild(el('div', { class: 'view' }, [
      el('div', { class: 'viewhead' }, [
        el('div', { class: 'viewhead__title' }, [
          stickerCluster([['coin', 'sun'], ['bolt', 'ember'], ['check', 'mint']]),
          el('div', {}, [
            el('span', { class: 'cap cap--muted', text: `${periodLabel} · ${fmtDate(from)} – ${fmtDate(to)}` }),
            el('h1', { text: 'Sales' }),
          ]),
        ]),
        segment([['month', 'This month'], ['last', 'Last month'], ['quarter', 'Quarter'],
          ['year', 'Year'], ['all', 'All time']], state.period,
          (v) => { state.period = v; rerender(); }),
      ]),

      el('div', { class: 'grid cols-4', style: 'margin-bottom:24px' }, [
        stat('Collected', money(collected, cur), `${inPeriod.length} payments`,
          { large: true, wash: 'mint' }),
        stat('Booked value', money(booked, cur), `${eventsInPeriod.length} events dated in period`),
        stat('Outstanding', money(outstanding, cur), `${receivables.length} bookings owing`,
          { wash: outstanding > 0 ? 'sun' : null }),
        stat('Average event', money(avgValue, cur), `${settledEvents.length} completed`),
      ]),

      el('div', { class: 'grid cols-3', style: 'margin-bottom:24px' }, [
        panel('Received by month — last 12',
          bars(months, { format: (v) => compact(v, cur) })),
        panel(`By package — ${periodLabel.toLowerCase()}`,
          byPackage.length
            ? bars(sortBy(byPackage, (r) => r.value, -1), { format: (v) => compact(v, cur) })
            : el('p', { class: 'empty', text: 'No payments in this period.' })),
        panel(`By method — ${periodLabel.toLowerCase()}`,
          byMethod.length
            ? bars(sortBy(byMethod, (r) => r.value, -1), { format: (v) => compact(v, cur) })
            : el('p', { class: 'empty', text: 'No payments in this period.' })),
      ]),

      el('div', { class: 'card__head' }, [
        el('span', { class: 'cap cap--muted',
          text: `Payment ledger — ${ledger.length} entries${refunds ? ` · ${money(refunds, cur)} refunded` : ''}` }),
        el('div', { class: 'row row--tight' }, [
          el('div', { style: 'width:240px' }, [
            search('Search client or reference…', state.q, (v) => { state.q = v; rerender(); }),
          ]),
          segment([['all', 'All'], ...PAY_METHODS.map((m) => [m, titleCase(m)])], state.method,
            (v) => { state.method = v; rerender(); }),
          button('Export CSV', () => exportLedger(ledger, cur), { quiet: true }),
        ]),
      ]),

      el('div', { style: 'margin-bottom:24px' }, [
        table([
          { label: 'Date', cell: (p) => fmtDate(p.paid_on) },
          { label: 'Client', cell: (p) => twoLine(p.client_name, p.reference) },
          { label: 'Kind', cell: (p) => tag(p.kind, p.kind === 'refund' ? 'ember' : 'sky') },
          { label: 'Method', cell: (p) => titleCase(p.method) },
          { label: 'Reference', cell: (p) => p.pay_ref || '—' },
          { label: 'Amount', align: 'right', cell: (p) => money(p.amount, cur) },
        ], ledger, {
          onRow: (p) => p.booking && editBooking(p.booking),
          empty: 'No payments recorded in this period.',
        }),
      ]),

      el('div', { class: 'card__head' }, [
        el('span', { class: 'cap cap--muted',
          text: `Receivables — ${money(outstanding, cur)} across ${receivables.length} bookings` }),
        button('Export CSV', () => exportReceivables(receivables, cur), { quiet: true }),
      ]),

      table([
          { label: 'Event date', cell: (b) => fmtDate(b.event_date, 'dow') },
          { label: 'Client', cell: (b) => twoLine(b.client_name, b.reference) },
          { label: 'Package', cell: (b) => b.package_name },
          { label: 'Status', cell: (b) => statusTag(b.status) },
          { label: 'Total', align: 'right', cell: (b) => money(b.total_amount, cur) },
          { label: 'Paid', align: 'right', cell: (b) => money(b.amount_paid, cur) },
          { label: 'Balance', align: 'right', cell: (b) => el('strong', { text: money(b.balance_due, cur) }) },
        ], sortBy(receivables, (b) => b.event_date), {
          onRow: (b) => editBooking(store.booking(b.id)),
          empty: 'Everything is settled.',
        }),
    ]));
  },
};

function exportLedger(rows, cur) {
  downloadText('payments.csv', toCSV(rows, [
    { label: 'Date', value: (p) => p.paid_on },
    { label: 'Booking', value: (p) => p.reference },
    { label: 'Client', value: (p) => p.client_name },
    { label: 'Kind', value: (p) => p.kind },
    { label: 'Method', value: (p) => p.method },
    { label: 'Reference', value: (p) => p.pay_ref || '' },
    { label: `Amount (${cur})`, value: (p) => num(p.amount).toFixed(2) },
    { label: 'Notes', value: (p) => p.notes || '' },
  ]));
  toast('payments.csv downloaded.');
}

function exportReceivables(rows, cur) {
  downloadText('receivables.csv', toCSV(rows, [
    { label: 'Booking', value: (b) => b.reference },
    { label: 'Event date', value: (b) => b.event_date },
    { label: 'Client', value: (b) => b.client_name },
    { label: 'Package', value: (b) => b.package_name },
    { label: 'Status', value: (b) => b.status },
    { label: `Total (${cur})`, value: (b) => num(b.total_amount).toFixed(2) },
    { label: `Paid (${cur})`, value: (b) => num(b.amount_paid).toFixed(2) },
    { label: `Balance (${cur})`, value: (b) => num(b.balance_due).toFixed(2) },
  ]));
  toast('receivables.csv downloaded.');
}
