/* Dashboard — what needs attention today, in one screen. */

import { store } from '../store.js';
import {
  el, money, compact, num, sum, sortBy, todayISO, toISO, fmtDate, fmtTime, relativeDay,
  daysFromToday, monthKey, monthLabel, MONTHS_SHORT, titleCase,
} from '../util.js';
import { table, panel, stat, bars, button, tag, statusTag, twoLine, stickerCluster,
} from '../ui.js';
import { editBooking, addPayment } from './scheduling.js';
import { openInvoiceFor } from './invoices.js';
import { moveStock } from './inventory.js';

export default {
  id: 'dashboard',
  label: 'Dashboard',

  render(root) {
    const cur = store.currency;
    const now = new Date();
    const monthStart = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const collected = store.revenueBetween(monthStart, monthEnd);
    const lastMonth = store.revenueBetween(
      toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      toISO(new Date(now.getFullYear(), now.getMonth(), 0)));
    const delta = lastMonth ? ((collected - lastMonth) / Math.abs(lastMonth)) * 100 : null;

    const upcoming = store.upcoming();
    const next30 = upcoming.filter((b) => daysFromToday(b.event_date) <= 30);
    const outstanding = store.outstanding();
    const low = store.lowStock();

    const unconfirmed = upcoming.filter((b) => b.status === 'inquiry');
    const thisWeek = upcoming.filter((b) => daysFromToday(b.event_date) <= 7);
    const overdue = store.bookingViews().filter((b) =>
      b.status === 'completed' && b.balance_due > 0.005);

    const months = store.monthlyRevenue(6).map((m) => ({
      label: `${MONTHS_SHORT[m.date.getMonth()]} ${String(m.date.getFullYear()).slice(2)}`,
      value: m.total,
    }));

    const pipeline = ['inquiry', 'confirmed', 'completed'].map((s) => ({
      label: titleCase(s),
      value: sum(store.bookings.filter((b) => b.status === s), (b) => num(b.total_amount)),
    }));

    const recentPayments = sortBy(store.payments, (p) => p.paid_on, -1).slice(0, 6);

    root.appendChild(el('div', { class: 'view' }, [
      el('div', { class: 'viewhead' }, [
        el('div', { class: 'viewhead__title' }, [
          stickerCluster([['star', 'violet'], ['coin', 'sun'], ['bolt', 'ember']]),
          el('div', {}, [
            el('span', { class: 'cap cap--muted', text: fmtDate(todayISO(), 'dow') }),
            el('h1', { text: store.settings?.company_name || 'Dashboard' }),
          ]),
        ]),
        el('div', { class: 'row row--tight' }, [
          button('New booking', () => editBooking(null), { solid: true }),
        ]),
      ]),

      /* ---- headline figures ---- */
      el('div', { class: 'grid cols-4', style: 'margin-bottom:24px' }, [
        stat('Collected this month', money(collected, cur),
          delta === null ? 'No prior month to compare'
            : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs ${monthLabel(new Date(now.getFullYear(), now.getMonth() - 1, 1)).split(' ')[0]}`,
          { large: true, wash: 'mint' }),
        stat('Events next 30 days', String(next30.length),
          thisWeek.length ? `${thisWeek.length} within 7 days` : 'Nothing this week',
          { wash: 'blue' }),
        stat('Outstanding balance', money(outstanding, cur),
          overdue.length ? `${overdue.length} past events still owing` : 'No past events owing',
          { wash: 'lavender' }),
        stat('Low stock', String(low.length),
          low.length ? low[0].name : 'All items above reorder level',
          { wash: low.length ? 'sun' : 'mist' }),
      ]),

      /* ---- attention strip ---- */
      (unconfirmed.length || overdue.length || low.length)
        ? el('div', { class: 'card card--wash-blue', style: 'margin-bottom:24px' }, [
            el('span', { class: 'cap', text: 'Needs attention' }),
            el('div', { class: 'row', style: 'margin-top:12px' }, [
              ...unconfirmed.slice(0, 4).map((b) => chip(
                `Unconfirmed · ${b.client_name} · ${fmtDate(b.event_date, 'short')}`,
                'sun', () => editBooking(store.booking(b.id)))),
              ...overdue.slice(0, 4).map((b) => chip(
                `Unpaid · ${b.client_name} · ${money(b.balance_due, cur)}`,
                'lavender', () => addPayment(store.booking(b.id)))),
              ...low.slice(0, 4).map((i) => chip(
                `Reorder · ${i.name} · ${num(i.quantity)} ${i.unit}`,
                'ember', () => moveStock(i))),
            ]),
          ])
        : null,

      /* ---- next events ---- */
      el('div', { class: 'grid cols-2', style: 'margin-bottom:24px' }, [
        panel(`Next events — ${upcoming.length} scheduled`,
          table([
            { label: 'When', cell: (b) => twoLine(fmtDate(b.event_date),
                `${fmtTime(b.start_time)} · ${relativeDay(b.event_date)}`) },
            { label: 'Client', cell: (b) => twoLine(b.client_name, b.package_name) },
            { label: 'Venue', cell: (b) => b.venue || '—' },
            { label: 'Status', cell: (b) => statusTag(b.status) },
            { label: 'Balance', align: 'right', cell: (b) =>
                b.balance_due > 0.005 ? money(b.balance_due, cur)
                  : el('span', { class: 'muted', text: 'Settled' }) },
          ], upcoming.slice(0, 8), {
            onRow: (b) => editBooking(store.booking(b.id)),
            empty: 'No upcoming events. Time to chase some enquiries.',
          }),
          button('New booking', () => editBooking(null), { quiet: true })),

        panel('Cash received — last 6 months',
          el('div', { class: 'stack' }, [
            bars(months, { format: (v) => compact(v, cur) }),
            el('div', { style: 'margin-top:24px' }, [
              el('span', { class: 'cap cap--muted', text: 'Booked value by stage' }),
              el('div', { style: 'margin-top:12px' }, [
                bars(pipeline, { format: (v) => compact(v, cur) }),
              ]),
            ]),
          ])),
      ]),

      /* ---- lower band ---- */
      el('div', { class: 'grid cols-2' }, [
        panel('Recent payments',
          table([
            { label: 'Date', cell: (p) => fmtDate(p.paid_on) },
            { label: 'Client', cell: (p) => {
                const b = store.booking(p.booking_id);
                return b ? store.view(b).client_name : '—';
              } },
            { label: 'Method', cell: (p) => titleCase(p.method) },
            { label: 'Amount', align: 'right', cell: (p) => money(p.amount, cur) },
          ], recentPayments, { empty: 'No payments recorded yet.' })),

        panel('Stock to reorder',
          table([
            { label: 'Item', cell: (i) => twoLine(i.name, i.sku || titleCase(i.category)) },
            { label: 'On hand', align: 'right', cell: (i) => `${num(i.quantity)} ${i.unit}` },
            { label: 'Reorder at', align: 'right', cell: (i) => `${num(i.reorder_level)} ${i.unit}` },
            { label: '', align: 'right', cell: (i) =>
                button('Stock in', () => moveStock(i), { quiet: true }) },
          ], low, { empty: 'Everything is above its reorder level.' })),
      ]),
    ]));
  },
};

const chip = (text, tone, onclick) =>
  el('button', { class: `tag tag--${tone}`, type: 'button', text, onclick });
