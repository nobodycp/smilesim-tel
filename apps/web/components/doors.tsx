import { DOOR_HOSTS, doorOrigin } from '../lib/doors';
import { copy } from '../lib/copy';

/**
 * The door picker on the bare host: the office's name, a title and a line, then one card per door (two columns, one
 * under 561px). The look is utilities since Tailwind migration T3.1 (from doors.css, base.css `.brand-name` and
 * forms.css `.lede`).
 */
export function Doors({ host, name }: { host: string; name?: string }) {
  const t = copy.ar;
  return (
    <main className="grid min-h-screen content-center justify-items-center gap-5.5 px-5 py-8">
      <div className="grid w-[min(520px,100%)] gap-1.5 text-center">
        <p className="m-0 text-base font-bold text-ink">{name || t.brand}</p>
        <h1 className="m-0 text-7xl">{t.doorsTitle}</h1>
        <p className="mx-0 mt-1.5 mb-4.5 text-muted">{t.doorsLede}</p>
      </div>
      <div className="grid w-[min(520px,100%)] grid-cols-2 gap-3 max-[561px]:grid-cols-1">
        {DOOR_HOSTS.map((door) => {
          const origin = doorOrigin(door, host || 'localhost:3000');
          return (
            <a
              key={door.host}
              className="grid gap-1.5 rounded-panel border border-solid border-line bg-surface px-4 py-4.5 text-ink no-underline shadow-card hover:border-ink"
              href={`http://${origin}/`}
            >
              <strong>{t[door.label]}</strong>
              <span className="text-sm text-muted" dir="ltr">{origin}</span>
            </a>
          );
        })}
      </div>
    </main>
  );
}
