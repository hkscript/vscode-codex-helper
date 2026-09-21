import { describe, expect, it } from 'vitest';
import { PIN_STATE_KEY, createPinStore } from '../../src/session/pinStore';
import { createFakeMemento } from '../helpers/fakes';

describe('pinStore', () => {
  it('pins_session_into_global_state', async () => {
    const memento = createFakeMemento();
    const store = createPinStore(memento);

    await store.pin('t1');

    expect(memento.store.get(PIN_STATE_KEY)).toEqual(['t1']);
    expect(store.list()).toEqual(['t1']);
    expect(store.isPinned('t1')).toBe(true);

    // 重复置顶不产生重复项
    await store.pin('t1');
    await store.pin('t2');
    expect(store.list()).toEqual(['t1', 't2']);
    expect(memento.store.get(PIN_STATE_KEY)).toEqual(['t1', 't2']);
  });

  it('unpins_session_from_global_state', async () => {
    const memento = createFakeMemento({ [PIN_STATE_KEY]: ['t1', 't2'] });
    const store = createPinStore(memento);

    await store.unpin('t1');

    expect(memento.store.get(PIN_STATE_KEY)).toEqual(['t2']);
    expect(store.list()).toEqual(['t2']);
    expect(store.isPinned('t1')).toBe(false);

    // 取消一个本就没置顶的 id 不应该破坏已有列表
    await store.unpin('nope');
    expect(store.list()).toEqual(['t2']);
  });

  it('returns_empty_list_when_state_absent', () => {
    const store = createPinStore(createFakeMemento());

    expect(store.list()).toEqual([]);
    expect(store.isPinned('t1')).toBe(false);

    // 历史遗留的脏数据不能把树搞崩
    const dirty = createPinStore(createFakeMemento({ [PIN_STATE_KEY]: 'not-an-array' }));
    expect(dirty.list()).toEqual([]);
  });
});
