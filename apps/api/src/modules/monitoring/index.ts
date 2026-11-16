// The public surface of the monitoring module (ADR 0020, amended 2026-11-17): what other modules may import from
// it. Monitoring sits above every module it reads, so no module imports it and the surface is empty; the
// composition roots (`app`: the registry, the request-log middleware) and the specs may reach inside.
