window.__ModuleLoader__.load({
  id: 'dsh-accountant',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ENDPOINT = '/accountant/spend';
    const TAG_ENDPOINT = '/accountant/tag';
    const MOVE_ENDPOINT = '/accountant/tag/move';
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
      .acc-spend__sep { opacity: 0.4; }
      .acc-spend__php { font-variant-numeric: tabular-nums; opacity: 0.72; font-weight: 500; }
      .acc-spend__tariff { font-size: 10.5px; opacity: 0.6; letter-spacing: 0.02em; }
      .acc-spend__tariff[data-peak='true'] { color: #c9962c; opacity: 0.95; }
      .acc-spend__tagchip { font-size: 10.5px; opacity: 0.75; }

      .acc-spend__more {
        width: 100%; margin-top: 8px; padding: 6px 8px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
        border-radius: 8px; background: transparent; color: inherit;
        font: inherit; font-size: 12px; cursor: pointer;
      }
      .acc-spend__more:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12)); }

      .acc-spend__overlay {
        position: fixed; inset: 0; z-index: 60;
        display: flex; align-items: center; justify-content: center;
        padding: 16px; background: rgba(0, 0, 0, 0.35);
      }
      .acc-spend__modal {
        width: 460px; max-width: 100%; max-height: 70vh; overflow: auto;
        padding: 14px 16px 12px; border-radius: 14px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
        background: var(--dsw-alias-bg-overlay, #fff);
        color: var(--dsw-alias-label-primary, currentColor);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
        font-size: 13px; line-height: 1.45;
      }
      .acc-spend__modalhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-weight: 600; }
      .acc-spend__close {
        border: 0; background: transparent; color: inherit; cursor: pointer;
        font: inherit; font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 6px; opacity: 0.7;
      }
      .acc-spend__close:hover { opacity: 1; background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12)); }
      .acc-spend__table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      .acc-spend__table th {
        text-align: right; font-weight: 550; font-size: 11px; opacity: 0.65;
        padding: 3px 0;
      }
      .acc-spend__table th:first-child, .acc-spend__table td:first-child { text-align: left; }
      .acc-spend__table td { padding: 6px 0; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16)); }
      .acc-spend__table td:not(:first-child), .acc-spend__table th:not(:first-child) { text-align: right; }
      .acc-spend__movesel { width: 116px; font-size: 12px; }

      .acc-spend__pop {
        position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
        width: 320px; padding: 13px 13px 11px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
        border-radius: 12px;
        background: var(--dsw-alias-bg-overlay, #ffffff);
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.18);
        color: var(--dsw-alias-label-primary, currentColor);
        font-size: 14px; line-height: 1.5;
        text-align: left;
      }

      .acc-spend__head {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 8px; margin-bottom: 8px;
      }
      .acc-spend__title { font-weight: 600; letter-spacing: 0.01em; }
      .acc-spend__zone { font-size: 13px; opacity: 0.6; }

      .acc-spend__row {
        display: grid; grid-template-columns: 1fr auto; align-items: baseline;
        gap: 2px 10px; padding: 5px 0;
      }
      .acc-spend__row + .acc-spend__row { border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16)); }
      .acc-spend__key { opacity: 0.75; }
      .acc-spend__peso { font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
      .acc-spend__sub { grid-column: 1 / -1; font-size: 13px; opacity: 0.6; font-variant-numeric: tabular-nums; }

      .acc-spend__predicted { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24)); }
      .acc-spend__foot { margin-top: 8px; font-size: 12px; opacity: 0.55; }

      .acc-spend__empty { padding: 4px 0; opacity: 0.7; }

      .acc-spend__taginput {
        width: 132px; min-width: 0;
        padding: 3px 6px; border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
        background: transparent; color: inherit;
        font: inherit; font-size: 12px; line-height: 1.3;
      }
      .acc-spend__taginput:focus-visible { outline: 2px solid var(--dsw-alias-border-focus, #4b7bec); outline-offset: 1px; }
      .acc-spend__taginput::placeholder { opacity: 0.55; }
      .acc-spend__taginput:disabled { opacity: 0.5; }
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

    function money(balance) {
      if (!balance) return '';
      const value = Number(balance.total) || 0;
      return balance.currency === 'USD' ? dollars(value) : `${balance.currency} ${value.toFixed(2)}`;
    }

    function clock(iso, timeZone) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
      } catch {
        return '';
      }
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

    function TagSpendModal({ rows, options = [], onMove, onClose }) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);

      return h(
        'div',
        { className: 'acc-spend__overlay', onClick: onClose },
        h(
          'div',
          {
            className: 'acc-spend__modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Spend by tag',
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { className: 'acc-spend__modalhead' },
            h('span', null, 'Spend by tag'),
            h('button', { type: 'button', className: 'acc-spend__close', 'aria-label': 'Close', onClick: onClose }, '×'),
          ),
          rows.length === 0
            ? h('div', { className: 'acc-spend__empty' }, 'No sessions yet.')
            : h(
                'table',
                { className: 'acc-spend__table' },
                h('thead', null, h('tr', null,
                  h('th', null, 'Tag'),
                  h('th', null, 'Sessions'),
                  h('th', null, 'Tokens'),
                  h('th', null, 'USD'),
                  h('th', null, 'PHP'),
                  h('th', { 'aria-label': 'Move to another tag' }, ''))),
                h('tbody', null, rows.map((row) => h(
                  'tr',
                  { key: row.tag },
                  h('td', null, row.tag),
                  h('td', null, row.sessions),
                  h('td', null, tokens(row.tokens)),
                  h('td', null, dollars(row.usd)),
                  h('td', null, peso(row.php)),
                  h(
                    'td',
                    null,
                    row.tag === 'untagged'
                      ? null
                      : h(
                          'select',
                          {
                            className: 'acc-spend__taginput acc-spend__movesel',
                            value: '',
                            'aria-label': `Move ${row.tag} to another tag`,
                            onChange: (event) => {
                              if (event.target.value !== '') onMove(row.tag, event.target.value);
                            },
                          },
                          h('option', { value: '' }, 'Move to…'),
                          options
                            .filter((tag) => tag !== row.tag)
                            .map((tag) => h('option', { key: tag, value: tag }, tag)),
                        ),
                  ),
                ))),
              ),
          h('div', { className: 'acc-spend__foot' }, 'All recorded sessions · estimates, not an invoice.'),
        ),
      );
    }

    function TagEditor({ session, options, onTag }) {
      // A ref, not state: disabling the select mid-save would fire the change again.
      const saving = React.useRef(false);
      const [adding, setAdding] = React.useState(false);

      const save = async (tag) => {
        if (saving.current) return false;
        saving.current = true;
        const ok = await onTag(tag);
        saving.current = false;
        return ok;
      };

      const onChange = async (event) => {
        const value = event.target.value;
        if (value === '__new') {
          setAdding(true);
          return;
        }
        await save(value === '' ? null : value);
      };

      const commitNew = async (event) => {
        const tag = event.target.value.trim();
        if (tag === '') {
          setAdding(false);
          return;
        }
        if (await save(tag)) setAdding(false);
      };

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'acc-spend__row' },
          h('span', { className: 'acc-spend__key' }, 'Tag'),
          h(
            'select',
            {
              className: 'acc-spend__taginput',
              value: adding ? '__new' : session.ownTag ?? '',
              'aria-label': 'Session tag',
              onChange,
            },
            h('option', { value: '' }, session.folderTag ? `Folder default: ${session.folderTag}` : 'No tag'),
            options.map((tag) => h('option', { key: tag, value: tag }, tag)),
            h('option', { value: '__new' }, '+ New tag…'),
          ),
          h(
            'span',
            { className: 'acc-spend__sub' },
            session.tagSource === 'session'
              ? 'this session'
              : session.folderTag
                ? `folder default · ${session.folderTag}`
                : 'no tag yet',
          ),
        ),
        adding
          ? h(
              'div',
              { className: 'acc-spend__row' },
              h('span', { className: 'acc-spend__key' }, 'New tag'),
              h('input', {
                className: 'acc-spend__taginput',
                placeholder: 'e.g. passion',
                maxLength: 40,
                autoFocus: true,
                'aria-label': 'New session tag',
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitNew(event);
                  }
                },
                onBlur: commitNew,
              }),
            )
          : null,
      );
    }

    function Popover({ data, stale, onTag, onOpenTags }) {
      const month = data !== null && data.month ? data.month : null;
      const week = data !== null && data.week ? data.week : null;
      const today = data !== null && data.today ? data.today : null;
      const scoped = data !== null && data.key && data.key.summary ? data.key.summary : null;
      const todayBucket = scoped ? scoped.today : today;
      const weekBucket = scoped ? scoped.week : week;
      const monthBucket = scoped ? scoped.month : month;
      const forecastBucket = scoped ? scoped.forecast : month ? month.forecast : null;

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
              data.session
                ? h(
                    'div',
                    { className: 'acc-spend__row' },
                    h('span', { className: 'acc-spend__key' }, 'This session'),
                    h('span', { className: 'acc-spend__peso' }, peso(data.session.php)),
                    h(
                      'span',
                      { className: 'acc-spend__sub' },
                      `${dollars(data.session.usd)} · ${tokens(data.session.tokens.total)} tokens · ${data.session.tag ?? data.session.label}`,
                    ),
                  )
                : null,
              data.session ? h(TagEditor, { session: data.session, options: data.tagOptions ?? [], onTag }) : null,
              h(Row, { label: today ? `Today · ${today.date.slice(5)}` : 'Today', bucket: todayBucket }),
              h(Row, { label: week ? `Week · ${week.key}` : 'Week', bucket: weekBucket }),
              h(Row, { label: month ? `Month · ${month.key}` : 'Month', bucket: monthBucket }),

              month
                ? h(
                    'div',
                    { className: 'acc-spend__predicted' },
                    h(Row, {
                      label: `Predicted month end · ${month.daysInMonth} days`,
                      bucket: forecastBucket,
                    }),
                  )
                : null,

              data.balance
                ? h(
                    'div',
                    { className: 'acc-spend__row' },
                    h('span', { className: 'acc-spend__key' }, 'Remaining'),
                    h('span', { className: 'acc-spend__peso' }, money(data.balance)),
                    h('span', { className: 'acc-spend__sub' }, 'account balance'),
                  )
                : null,
              data.byTag && data.byTag.length > 0
                ? h('button', { type: 'button', className: 'acc-spend__more', onClick: onOpenTags }, `Spend by tag · ${data.byTag.length}`)
                : null,

              h(
                'div',
                { className: 'acc-spend__foot' },
                `Estimate · ₱${Number(data.fx.rate).toFixed(2)} per USD · ${data.coverage.sessions} sessions${data.key ? ` · key ${data.key.fingerprint.slice(0, 8)}…` : ''}`,
              ),
            ),
      );
    }

    function SpendChip({ sessionId }) {
      const [state, setState] = React.useState({ status: 'loading', data: null });
      const [open, setOpen] = React.useState(false);
      const [tagModal, setTagModal] = React.useState(false);
      const rootRef = React.useRef(null);
      const aliveRef = React.useRef(true);

      const load = React.useCallback(async () => {
        if (typeof fetch !== 'function') return;
        try {
          const url = sessionId ? `${ENDPOINT}?session=${encodeURIComponent(sessionId)}` : ENDPOINT;
          const response = await fetch(url, {
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
      }, [sessionId]);

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

      const saveTag = React.useCallback(async (tag) => {
        if (!sessionId) return false;
        try {
          const response = await fetch(TAG_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            body: JSON.stringify({ session: sessionId, tag }),
          });
          if (!response.ok) return false;
          await load();
          return true;
        } catch {
          return false;
        }
      }, [sessionId, load]);

      const moveTag = React.useCallback(async (from, to) => {
        try {
          const response = await fetch(MOVE_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            body: JSON.stringify({ from, to }),
          });
          if (!response.ok) return false;
          await load();
          return true;
        } catch {
          return false;
        }
      }, [load]);

      const data = state.data;
      const stale = state.status === 'error';
      const ready = data !== null && data.today !== undefined;
      const keyBucket = ready && data.key
        ? data.key.summary ? data.key.summary.today : data.key.totals
        : null;
      const shown = keyBucket ?? (ready ? data.today : null);

      const summary = (ready
        ? keyBucket
          ? `This key · today ${dollars(keyBucket.usd)} · ${peso(keyBucket.php)}${data.key.summary ? ` · week ${peso(data.key.summary.week.php)} · month ${peso(data.key.summary.month.php)}` : ''} · all today ${dollars(data.today.usd)} · ${peso(data.today.php)}`
          : `Today ${dollars(data.today.usd)} · ${peso(data.today.php)} · Week ${peso(data.week.php)} · Month ${peso(data.month.php)} · predicted month end ${peso(data.month.forecast.php)}`
        : stale
          ? 'Accountant: no data from the accounting endpoint'
          : 'Accountant: reading token spend') + (ready && data.session
            ? ` · session ${dollars(data.session.usd)} ${peso(data.session.php)}`
            : '') + (ready && data.tariff
            ? ` · ${data.tariff.peak ? 'peak' : 'off-peak'}${clock(data.tariff.changesAt, data.timezone) ? ` until ${clock(data.tariff.changesAt, data.timezone)}` : ''}`
            : '');

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
          ready && shown
            ? h(
                React.Fragment,
                null,
                h('span', { className: 'acc-spend__value' }, dollars(shown.usd)),
                h('span', { className: 'acc-spend__sep', 'aria-hidden': true }, '·'),
                h('span', { className: 'acc-spend__php' }, peso(shown.php)),
                ready && data.tariff
                  ? h(
                      React.Fragment,
                      null,
                      h('span', { className: 'acc-spend__sep', 'aria-hidden': true }, '·'),
                      h(
                        'span',
                        { className: 'acc-spend__tariff', 'data-peak': data.tariff.peak ? 'true' : 'false' },
                        data.tariff.peak ? 'Peak' : 'Off-peak',
                      ),
                    )
                  : null,
                ready && open && data.session && data.session.tag
                  ? h(
                      React.Fragment,
                      null,
                      h('span', { className: 'acc-spend__sep', 'aria-hidden': true }, '·'),
                      h('span', { className: 'acc-spend__tagchip' }, data.session.tag),
                    )
                  : null,
              )
            : h('span', { className: 'acc-spend__value' }, '—'),
        ),
        open ? h(Popover, {
          data,
          stale,
          onTag: saveTag,
          onOpenTags: () => {
            setTagModal(true);
            setOpen(false);
          },
        }) : null,
        tagModal && data !== null
          ? h(TagSpendModal, {
              rows: data.byTag ?? [],
              options: data.tagOptions ?? [],
              onMove: moveTag,
              onClose: () => setTagModal(false),
            })
          : null,
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
              inject: (sessionId) => ({ sessionId }),
            },
            SpendChip,
          ),
        );
      },
    };
  },
});
