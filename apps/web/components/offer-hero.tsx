'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Offer } from '../lib/api';
import { cn } from '../lib/cn';
import { usePrefs } from '../lib/prefs';
import { DataImage } from './data-image';

/*
 * The hero's look (Tailwind migration T4.1), ported from desk/home.css with responsive.css:
 * - the hero: a card clipped to 8px corners, a 1px `--rd-line` border on `--rd-surface` with the card shadow; a 2px ink
 *   outline 2px out on keyboard focus;
 * - a slide: the text at the reading start and the picture at the end, 16px apart, 16px / 20px padding and 28px at the
 *   foot (room for the dots); it fades in when motion is allowed. Text only (`data-text-only`), it is one column. Under
 *   761px it is one column 10px apart, 14px padding and 30px at the foot, the picture first across the slide, at most
 *   160px high, and the title 16px;
 * - the text: a column 4px apart at the reading start; the title 18px, 1.3 line height; the body 13px `--rd-muted`, 1.6
 *   line height; the action a 34px pill 6px under it, 14px padding, 13px bold `--rd-on-accent` on `--rd-accent-fill`
 *   (`--rd-accent-fill-hover` under the pointer);
 * - the picture 240px wide, 2:1, covering, 8px corners;
 * - the arrows: 36px round buttons at the middle of each side, 8px in, a 1px `--rd-line` border on `--rd-surface`,
 *   ink; hidden until the pointer is over the hero or focus is in it (they fade in), gone under 761px;
 * - the dots: centred along the foot, 4px up; each button at least 20px by 24px (44px high at 720px and under, as every
 *   button on the canvas) with 2px padding; the dot an 8px pill of `--rd-surface-3`, 36px wide for the current offer
 *   (it widens over 180ms); its timer fills it with `--rd-primary-bg` from the reading start, linearly, over the offer's
 *   seconds (the `offer-fill` keyframes in desk/home.css). With reduced motion the slide does not fade and the timer
 *   does not run.
 */
const ACTION = 'mt-1.5 inline-flex min-h-8.5 items-center rounded-pill bg-accent-fill px-3.5 text-md font-bold text-on-accent hover:bg-accent-fill-hover';
const ARROW = cn(
  'absolute top-1/2 -mt-4.5 inline-flex size-9 items-center justify-center rounded-pill border border-line bg-surface text-ink',
  'opacity-0 transition-opacity duration-fast ease-out group-hover/hero:opacity-100 group-focus-within/hero:opacity-100 max-[761px]:hidden',
);

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
      className="group/hero relative overflow-hidden rounded-lg border border-line bg-surface shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      data-testid="offer-hero"
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
      {/* The picture is optional: without one the offer is text only and takes the whole width. */}
      <div
        className={cn(
          'grid items-center gap-4 px-5 pt-4 pb-7 motion-safe:animate-[offer-in_var(--rd-dur-base)_var(--rd-ease-out)]',
          'max-[761px]:grid-cols-1 max-[761px]:gap-2.5 max-[761px]:p-3.5 max-[761px]:pb-7.5',
          current.image ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
        )}
        data-testid="offer-slide"
        data-text-only={current.image ? undefined : ''}
        key={current.id}
        aria-live={paused ? 'polite' : 'off'}
      >
        <div className="grid content-center justify-items-start gap-1">
          <h2 className="m-0 text-2xl leading-[1.3] max-[761px]:text-xl">{current.title}</h2>
          {current.body ? <p className="m-0 text-md leading-[1.6] text-muted">{current.body}</p> : null}
          {current.actionHref && current.actionLabel ? (
            external
              ? <a className={ACTION} href={current.actionHref} target="_blank" rel="noopener noreferrer">{current.actionLabel}</a>
              : <Link className={ACTION} href={current.actionHref}>{current.actionLabel}</Link>
          ) : null}
        </div>
        {current.image ? <DataImage className="aspect-[2/1] inline-60 rounded-card object-cover max-[761px]:-order-1 max-[761px]:inline-full max-[761px]:max-block-40" src={current.image} alt="" /> : null}
      </div>
      {count > 1 ? (
        <>
          <button type="button" className={cn(ARROW, 'start-2')} aria-label={t.offerPrevious} onClick={() => go(index - 1)}>
            {rtl ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
          </button>
          <button type="button" className={cn(ARROW, 'end-2')} aria-label={t.offerNext} onClick={() => go(index + 1)}>
            {rtl ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          </button>
          <div className="absolute inset-x-0 bottom-1 flex justify-center gap-0" role="tablist" aria-label={t.offersTitle}>
            {offers.map((offer, at) => (
              <button
                key={offer.id}
                type="button"
                role="tab"
                aria-selected={at === index}
                aria-label={`${at + 1} / ${count} · ${offer.title}`}
                className="inline-flex min-h-6 min-w-5 items-center justify-center border-0 bg-transparent px-0.5 py-0 max-[721px]:min-h-11"
                onClick={() => go(at)}
              >
                {/* The button is the touch target; the bar inside is the dot people see. */}
                <span
                  className={cn(
                    'relative block block-2 overflow-hidden rounded-pill bg-surface-3 transition-[inline-size] duration-base ease-out',
                    at === index ? 'inline-9' : 'inline-2',
                  )}
                  aria-hidden="true"
                >
                  {at === index ? (
                    <span
                      key={`${offer.id}-${index}`}
                      className="absolute inset-y-0 start-0 inline-full origin-left rounded-[inherit] bg-primary-bg motion-safe:animate-[offer-fill_linear_both] rtl:origin-right"
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
