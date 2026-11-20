/** Limit concurrent deck reads while keeping results in the input order. */
export async function mapDeckReads<T, R>(decks: readonly T[], read: (deck: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(decks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < decks.length) {
      const index = nextIndex++;
      results[index] = await read(decks[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, decks.length) }, () => worker()));
  return results;
}
