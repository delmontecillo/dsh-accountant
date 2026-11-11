window.__ModuleLoader__.load({
  id: 'dsh-accountant',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ENDPOINT = '/accountant/spend';
    const POLL_MS = 60_000;

    const CSS = `
      .acc-spend { position: relative; display: inline-flex; align-items: center; }

      .acc-spend__chip {
        display: inline-flex; align-items: center; gap: 6px;
        height: 26px; padding: 0 10px 0 8px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
        border-radius: 999px;
        background: transparent; color: var(--dsw-alias-label-secondary, currentColor);
        font: inherit; font-size: 12px; font-weight: 550; line-height: 1;
        letter-spacing: 0.01em; white-space: nowrap; cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease;
      }
      .acc-spend__chip:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12)); }
      .acc-spend__chip:focus-visible { outline: 2px solid var(--dsw-alias-border-focus, #4b7bec); outline-offset: 2px; }
      .acc-spend__chip[aria-expanded='true'] { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12)); }

      .acc-spend__dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #c9962c;
        box-shadow: 0 0 0 2px rgba(201, 150, 44, 0.18);
        flex: none;
      }
      .acc-spend__dot[data-state='stale'] { background: #9aa4b2; box-shadow: none; }

      .acc-spend__value { font-variant-numeric: tabular-nums; }
      .acc-spend__label { color: var(--dsw-alias-label-tertiary, currentColor); opacity: 0.72; font-weight: 500; }

      .acc-spend__pop {
        position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
        width: 272px; padding: 12px 12px 10px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
        border-radius: 12px;
        background: var(--dsw-alias-bg-overlay, #ffffff);
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.18);
        color: var(--dsw-alias-label-primary, currentColor);
        font-size: 12px; line-height: 1.45;
        text-align: left;
      }

      .acc-spend__head {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 8px; margin-bottom: 8px;
      }
      .acc-spend__title { font-weight: 600; letter-spacing: 0.01em; }
      .acc-spend__zone { font-size: 11px; opacity: 0.6; }

      .acc-spend__row {
        display: grid; grid-template-columns: 1fr auto; align-items: baseline;
        gap: 2px 10px; padding: 5px 0;
      }
      .acc-spend__row + .acc-spend__row { border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16)); }
      .acc-spend__key { opacity: 0.75; }
      .acc-spend__peso { font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
      .acc-spend__sub { grid-column: 1 / -1; font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums; }

      .acc-spend__predicted { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24)); }
      .acc-spend__foot { margin-top: 8px; font-size: 10.5px; opacity: 0.55; }

      .acc-spend__empty { padding: 4px 0; opacity: 0.7; }
    `;

    function peso(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '₱0.00';
      if (n < 1) return `₱${n.toFixed(4)}`;
      return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function dollars(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '$0.00';
      if (n < 1) return `$${n.toFixed(4)}`;
      return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function tokens(value) {
      const n = Number(value) || 0;
      if (n < 1000) return String(Math.round(n));
      if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
      return `${(n / 1_000_000).toFixed(1)}M`;
    }

    function Row({ label, bucket }) {
      if (!bucket) return null;
      return h(
        'div',
        { className: 'acc-spend__row' },
        h('span', { className: 'acc-spend__key' }, label),
        h('span', { className: 'acc-spend__peso' }, peso(bucket.php)),
        h('span', { className: 'acc-spend__sub' }, `${dollars(bucket.usd)} · ${tokens(bucket.tokens)} tokens`),
      );
    }

    function Popover({ data, stale }) {
      const month = data !== null && data.month ? data.month : null;
      const week = data !== null && data.week ? data.week : null;
      const today = data !== null && data.today ? data.today : null;

      return h(
        'div',
        { className: 'acc-spend__pop', role: 'dialog', 'aria-label': 'Token spend' },
        h(
          'div',
          { className: 'acc-spend__head' },
          h('span', { className: 'acc-spend__title' }, 'Token spend'),
          h('span', { className: 'acc-spend__zone' }, data ? data.timezone : ''),
        ),

        stale || data === null
          ? h('div', { className: 'acc-spend__empty' }, stale
              ? 'The accounting endpoint is not answering. Is the plugin still enabled?'
              : 'Reading the session store…')
          : h(
              React.Fragment,
              null,
              h(Row, { label: today ? `Today · ${today.date.slice(5)}` : 'Today', bucket: today }),
              h(Row, { label: week ? `Week · ${week.key}` : 'Week', bucket: week }),
              h(Row, { label: month ? `Month · ${month.key}` : 'Month', bucket: month }),

              month
                ? h(
                    'div',
                    { className: 'acc-spend__predicted' },
                    h(Row, {
                      label: `Predicted month end · ${month.daysInMonth} days`,
                      bucket: month.forecast,
                    }),
                  )
                : null,

              h(
                'div',
                { className: 'acc-spend__foot' },
                `Estimate · ₱${Number(data.fx.rate).toFixed(2)} per USD · ${data.coverage.sessions} sessions`,
              ),
            ),
      );
    }

    function SpendChip() {
      const [state, setState] = React.useState({ status: 'loading', data: null });
      const [open, setOpen] = React.useState(false);
      const rootRef = React.useRef(null);
      const aliveRef = React.useRef(true);

      const load = React.useCallback(async () => {
        if (typeof fetch !== 'function') return;
        try {
          const response = await fetch(ENDPOINT, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            credentials: 'same-origin',
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (aliveRef.current) setState({ status: 'ready', data });
        } catch {
          if (aliveRef.current) setState({ status: 'error', data: null });
        }
      }, []);

      React.useEffect(() => {
        aliveRef.current = true;
        load();
        const timer = setInterval(load, POLL_MS);
        return () => {
          aliveRef.current = false;
          clearInterval(timer);
        };
      }, [load]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('mousedown', onPointerDown);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);

      const data = state.data;
      const stale = state.status === 'error';
      const todayPhp = data && data.today ? peso(data.today.php) : '—';

      const summary = data
        ? `Today ${peso(data.today.php)} · Week ${peso(data.week.php)} · Month ${peso(data.month.php)} · predicted month end ${peso(data.month.forecast.php)}`
        : stale
          ? 'Accountant: no data from the accounting endpoint'
          : 'Accountant: reading token spend';

      return h(
        'div',
        { className: 'acc-spend', ref: rootRef },
        h(
          'button',
          {
            type: 'button',
            className: 'acc-spend__chip',
            title: summary,
            'aria-label': summary,
            'aria-expanded': open ? 'true' : 'false',
            'data-accountant': 'spend-chip',
            onClick: () => {
              setOpen((value) => !value);
              load();
            },
          },
          h('span', { className: 'acc-spend__dot', 'data-state': stale ? 'stale' : 'live', 'aria-hidden': true }),
          h('span', { className: 'acc-spend__value' }, todayPhp),
          h('span', { className: 'acc-spend__label' }, 'today'),
        ),
        open ? h(Popover, { data, stale }) : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.setAttribute('data-accountant', 'spend-chip');
          style.textContent = CSS;
          document.head.append(style);
          return () => style.remove();
        }, 'accountant: styles');

        // The right-aligned utilities seat of the Session header: the same row
        // as the mode switch, so the spend reads as window chrome.
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'accountant-spend',
              order: 6,
            },
            () => h(SpendChip),
          ),
        );
      },
    };
  },
});
