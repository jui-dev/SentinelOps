import { mergeHistory } from './incidents.history.js';

const at = (id: string, createdAt: string, resolvedAt?: string) => ({
  id,
  createdAt: new Date(createdAt),
  resolvedAt: resolvedAt ? new Date(resolvedAt) : null,
});

const period = {
  gte: new Date('2026-09-13T00:00:00Z'),
  lt: new Date('2026-09-20T00:00:00Z'),
};

describe('period history', () => {
  it('should order by what happened last: a resolution, or else a declaration', () => {
    const old = at('old', '2026-09-10T08:00:00Z', '2026-09-18T09:00:00Z');
    const fresh = at('fresh', '2026-09-18T07:00:00Z');
    const short = at('short', '2026-09-18T10:00:00Z', '2026-09-18T10:30:00Z');

    expect(
      mergeHistory([fresh, short], [short, old], period, 10).map((entry) => [
        entry.incident.id,
        entry.declaredInPeriod,
        entry.resolvedInPeriod,
      ]),
    ).toEqual([
      // Resolved at 10:30, declared at 10:00: one entry, both flags.
      ['short', true, true],
      // Resolved in the period, declared before it.
      ['old', false, true],
      // Declared in the period, still running.
      ['fresh', true, false],
    ]);
  });

  it('should list an incident once, however both lists name it', () => {
    const one = at('one', '2026-09-18T07:00:00Z', '2026-09-18T08:00:00Z');

    expect(mergeHistory([one], [one], period, 10)).toHaveLength(1);
  });

  it('should keep the most recent, up to the limit', () => {
    const declared = Array.from({ length: 10 }, (_, index) =>
      at(`d${index}`, `2026-09-18T${String(index).padStart(2, '0')}:00:00Z`),
    );
    const resolved = Array.from({ length: 10 }, (_, index) =>
      at(
        `r${index}`,
        '2026-09-01T00:00:00Z',
        `2026-09-18T${String(index).padStart(2, '0')}:30:00Z`,
      ),
    );

    const merged = mergeHistory(declared, resolved, period, 10);

    expect(merged).toHaveLength(10);
    expect(merged[0].incident.id).toBe('r9');
    expect(merged[1].incident.id).toBe('d9');
    // The two lists interleave: r9, d9, r8, d8 … and the tenth is d5.
    expect(merged.at(-1)?.incident.id).toBe('d5');
  });

  it('should hold nothing when nothing happened', () => {
    expect(mergeHistory([], [], period, 10)).toEqual([]);
  });
});
