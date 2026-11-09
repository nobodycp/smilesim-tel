'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Offer } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { DataImage } from './data-image';

/**
 * The home hero (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1): the live offers one at a time, each for its own
 * `seconds`. The fill inside the current dot is the timer: when it ends the next offer comes; it stops while the
 * pointer is over the hero, while it has focus and while the tab is hidden, and it does not run with reduced motion.
 * A dot, an arrow, a swipe or the arrow keys move at once and start the timer again on the chosen offer.
 */
export function OfferHero({ offers }: { offers: Offer[] }) {
  const { t } = usePrefs();
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const swipe = useRef<{ x: number; id: number } | null>(null);
  const count = offers.length;
  const current = offers[Math.min(index, count - 1)];

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!current) return null;
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const go = (next: number) => setIndex(((next % count) + count) % count);
  const paused = hovered || focused || hidden;

  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (count < 2) return;
    // In a right-to-left page the next offer is to the left.
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index + (rtl ? 1 : -1)); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + (rtl ? -1 : 1)); }
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse') swipe.current = { x: event.clientX, id: event.pointerId };
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || count < 2 || start.id !== event.pointerId) return;
    const moved = event.clientX - start.x;
    if (Math.abs(moved) < 40) return;
    // A swipe toward the reading end shows the next offer.
    const towardEnd = rtl ? moved > 0 : moved < 0;
    go(index + (towardEnd ? 1 : -1));
  }

  const external = current.actionHref?.startsWith('https://');
  return (
    <section
      className="offer-hero"
      aria-roledescription={t.offersCarousel}
      aria-label={t.offersTitle}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="offer-slide" key={current.id} aria-live={paused ? 'polite' : 'off'}>
        <div className="offer-copy">
          <h2>{current.title}</h2>
          {current.body ? <p>{current.body}</p> : null}
          {current.actionHref && current.actionLabel ? (
            external
              ? <a className="offer-action" href={current.actionHref} target="_blank" rel="noopener noreferrer">{current.actionLabel}</a>
              : <Link className="offer-action" href={current.actionHref}>{current.actionLabel}</Link>
          ) : null}
        </div>
        {current.image ? <DataImage className="offer-image" src={current.image} alt="" /> : <div className="offer-image offer-image-empty" aria-hidden="true" />}
      </div>
      {count > 1 ? (
        <>
          <button type="button" className="offer-arrow prev" aria-label={t.offerPrevious} onClick={() => go(index - 1)}>
            {rtl ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
          </button>
          <button type="button" className="offer-arrow next" aria-label={t.offerNext} onClick={() => go(index + 1)}>
            {rtl ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          </button>
          <div className="offer-dots" role="tablist" aria-label={t.offersTitle}>
            {offers.map((offer, at) => (
              <button
                key={offer.id}
                type="button"
                role="tab"
                aria-selected={at === index}
                aria-label={`${at + 1} / ${count} · ${offer.title}`}
                className={at === index ? 'offer-dot is-on' : 'offer-dot'}
                onClick={() => go(at)}
              >
                {/* The button is the touch target; the bar inside is the dot people see. */}
                <span className="offer-dot-bar" aria-hidden="true">
                  {at === index ? (
                    <span
                      key={`${offer.id}-${index}`}
                      className="offer-dot-fill"
                      style={{ animationDuration: `${offer.seconds}s`, animationPlayState: paused ? 'paused' : 'running' }}
                      onAnimationEnd={() => go(index + 1)}
                    />
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
