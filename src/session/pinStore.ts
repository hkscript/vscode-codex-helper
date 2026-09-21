import type { MementoLike } from '../codex/types';

/**
 * Pinned sessions live in this extension's own `globalState`.
 * `thread/metadata/update` only patches `gitInfo`, so there is no
 * protocol-level slot to store them on the Codex side (design decision D5).
 */
export const PIN_STATE_KEY = 'codexHelper.pinnedSessionIds';

export interface PinStore {
  list(): string[];
  isPinned(id: string): boolean;
  pin(id: string): Promise<void>;
  unpin(id: string): Promise<void>;
}

export function createPinStore(memento: MementoLike): PinStore {
  function read(): string[] {
    const raw = memento.get<unknown>(PIN_STATE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is string => typeof entry === 'string');
  }

  function write(ids: string[]): Promise<void> {
    return Promise.resolve(memento.update(PIN_STATE_KEY, ids));
  }

  return {
    list: read,
    isPinned: (id: string) => read().includes(id),
    async pin(id: string): Promise<void> {
      const ids = read();
      if (ids.includes(id)) return;
      await write([...ids, id]);
    },
    async unpin(id: string): Promise<void> {
      const ids = read();
      if (!ids.includes(id)) return;
      await write(ids.filter((entry) => entry !== id));
    },
  };
}
