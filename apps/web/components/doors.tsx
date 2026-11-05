import { DOOR_HOSTS, doorOrigin } from '../lib/doors';
import { copy } from '../lib/copy';

export function Doors({ host, name }: { host: string; name?: string }) {
  const t = copy.ar;
  return (
    <main className="doors">
      <div className="doors-copy">
        <p className="brand-name">{name || t.brand}</p>
        <h1>{t.doorsTitle}</h1>
        <p className="lede">{t.doorsLede}</p>
      </div>
      <div className="door-grid">
        {DOOR_HOSTS.map((door) => {
          const origin = doorOrigin(door, host || 'localhost:3000');
          return (
            <a key={door.host} className="door-card" href={`http://${origin}/`}>
              <strong>{t[door.label]}</strong>
              <span dir="ltr">{origin}</span>
            </a>
          );
        })}
      </div>
    </main>
  );
}
