/**
 * Everything the process writes to stdout and stderr while `run` is in flight, as one string: what a log
 * collector would receive. The real writes are held back so a spec's output stays readable.
 */
export async function capturedOutput(run: () => Promise<unknown>): Promise<string> {
  const written: string[] = [];
  const take = (chunk: unknown) => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
    return true;
  };
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(take as never);
  const err = jest.spyOn(process.stderr, 'write').mockImplementation(take as never);
  try {
    await run();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return written.join('');
}
