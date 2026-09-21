import { describe, expect, it } from 'vitest';
import type { Thread, Turn, TurnStatus } from '../../src/codex/types';
import {
  computeRunningIds,
  hasNoTerminalRecord,
  selectCandidates,
} from '../../src/session/runningState';
import { makeThread, makeTurn } from '../helpers/fakes';

const NOW = 1_789_970_400;
const STALE = 300;

function thread(id: string, updatedAt = NOW): Thread {
  return makeThread({ id, updatedAt, path: `/sessions/rollout-2026-09-21T13-08-48-${id}.jsonl` });
}

/** held = 这些 id 被存活进程持有；null = 平台无法探测归属。 */
function held(...ids: string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, 4000 + index]));
}

function run(input: {
  threads: Thread[];
  turns?: Array<[string, Turn | undefined]>;
  heldRollouts?: Map<string, number> | null;
  nowSeconds?: number;
}): Set<string> {
  return computeRunningIds({
    threads: input.threads,
    turns: new Map(input.turns ?? []),
    heldRollouts: input.heldRollouts === undefined ? held() : input.heldRollouts,
    nowSeconds: input.nowSeconds ?? NOW,
    staleSeconds: STALE,
  });
}

describe('runningState', () => {
  it('marks_running_when_turn_in_progress_and_owner_alive', () => {
    const ids = run({
      threads: [thread('t1')],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'inProgress', completedAt: null })]],
      heldRollouts: held('t1'),
    });

    expect(ids.has('t1')).toBe(true);
  });

  it('marks_running_when_interrupted_without_completed_at_and_owner_alive', () => {
    // 跨进程读到的「正在跑」就是这个形状（design D15），不是 inProgress
    const ids = run({
      threads: [thread('t1')],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null })]],
      heldRollouts: held('t1'),
    });

    expect(ids.has('t1')).toBe(true);
    expect(hasNoTerminalRecord(makeTurn({ id: 'x', status: 'interrupted', completedAt: null }))).toBe(
      true,
    );
  });

  it('not_running_when_latest_turn_has_terminal_record', () => {
    // §6.1 第 3/4/5 行：三种终止状态都必须判非运行。
    // 同一轮里放一个确实在跑的会话，否则「永远返回空集合」也能满足下面的否定断言。
    for (const status of ['completed', 'interrupted', 'failed'] as TurnStatus[]) {
      const ids = run({
        threads: [thread('t1'), thread('busy')],
        turns: [
          ['t1', makeTurn({ id: 'turn-1', status, completedAt: NOW - 10 })],
          ['busy', makeTurn({ id: 'turn-2', status: 'inProgress', completedAt: null })],
        ],
        heldRollouts: held('t1', 'busy'),
      });
      expect(ids.has('busy'), `status=${status} 的对照组`).toBe(true);
      expect(ids.has('t1'), `status=${status}`).toBe(false);
    }
  });

  it('not_running_when_no_live_owner_holds_rollout', () => {
    // §6.1 第 6/7 行：没有终止记录，但没人持有 ⇒ 进程死了留下的半截回合
    for (const status of ['inProgress', 'interrupted'] as TurnStatus[]) {
      const ids = run({
        threads: [thread('t1'), thread('busy')],
        turns: [
          ['t1', makeTurn({ id: 'turn-1', status, completedAt: null })],
          ['busy', makeTurn({ id: 'turn-2', status, completedAt: null })],
        ],
        heldRollouts: held('busy'),
      });
      // 唯一的区别是归属：同样的回合形状，被持有的那个必须是运行中
      expect(ids.has('busy'), `status=${status} 的对照组`).toBe(true);
      expect(ids.has('t1'), `status=${status}`).toBe(false);
    }
  });

  it('stale_mtime_does_not_clear_running_when_owner_alive', () => {
    // §6.1 第 2b 行：Linux 路径上时间阈值不参与判定，长思考不能被误杀
    const ids = run({
      threads: [thread('t1', NOW - STALE * 10)],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null })]],
      heldRollouts: held('t1'),
    });

    expect(ids.has('t1')).toBe(true);
  });

  it('not_running_when_thread_has_no_turns', () => {
    const ids = run({
      threads: [thread('t1'), thread('busy')],
      turns: [
        ['t1', undefined],
        ['busy', makeTurn({ id: 'turn-2', status: 'inProgress', completedAt: null })],
      ],
      heldRollouts: held('t1', 'busy'),
    });

    expect(ids.has('busy')).toBe(true);
    expect(ids.has('t1')).toBe(false);
    expect(hasNoTerminalRecord(undefined)).toBe(false);
  });

  it('missing_rollout_path_is_not_running_and_does_not_throw', () => {
    // rollout 文件延迟创建：只 thread/start 没发回合时 path 为空
    const noPath = makeThread({ id: 't1', path: null, updatedAt: NOW });
    let ids: Set<string> | undefined;

    expect(() => {
      ids = run({
        threads: [noPath, thread('busy')],
        turns: [
          ['t1', makeTurn({ id: 'turn-1', status: 'inProgress', completedAt: null })],
          ['busy', makeTurn({ id: 'turn-2', status: 'inProgress', completedAt: null })],
        ],
        heldRollouts: held('t1', 'busy'),
      });
    }).not.toThrow();
    // 对照组证明这条断言有失败能力：同样的回合 + 归属，只差一个 path
    expect(ids!.has('busy')).toBe(true);
    expect(ids!.has('t1')).toBe(false);

    // path 字段整个缺失（旧服务端）同样安全
    expect(
      run({ threads: [makeThread({ id: 't2', updatedAt: NOW })], heldRollouts: held('t2') }).size,
    ).toBe(0);
  });

  it('turn_query_failure_isolates_to_that_session', () => {
    // D24：t1 的查询失败（turns 里没有它）不能带走 t2 的运行标识
    const ids = run({
      threads: [thread('t1'), thread('t2')],
      turns: [['t2', makeTurn({ id: 'turn-2', status: 'inProgress', completedAt: null })]],
      heldRollouts: held('t1', 't2'),
    });

    expect(ids.has('t2')).toBe(true);
    expect(ids.has('t1')).toBe(false);
  });

  it('fallback_marks_running_within_stale_threshold', () => {
    // §6.1 第 11 行：探测不可用 + 刚写过 ⇒ 视为运行中
    const ids = run({
      threads: [thread('t1', NOW - STALE + 1)],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null })]],
      heldRollouts: null,
    });

    expect(ids.has('t1')).toBe(true);
  });

  it('fallback_clears_running_beyond_stale_threshold', () => {
    // §6.1 第 12 行：探测不可用 + 超过阈值 ⇒ 非运行。
    // 阈值内的那个是对照组，保证这条不是靠「永远空集合」通过的。
    const ids = run({
      threads: [thread('t1', NOW - STALE - 1), thread('fresh', NOW - STALE + 1)],
      turns: [
        ['t1', makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null })],
        ['fresh', makeTurn({ id: 'turn-2', status: 'interrupted', completedAt: null })],
      ],
      heldRollouts: null,
    });

    expect(ids.has('fresh')).toBe(true);
    expect(ids.has('t1')).toBe(false);
  });

  it('candidates_exclude_sessions_not_held_by_any_process', () => {
    const threads = [
      thread('t1'),
      thread('t2'),
      makeThread({ id: 't3', path: null, updatedAt: NOW }),
    ];

    const linux = selectCandidates({
      threads,
      heldRollouts: held('t1'),
      nowSeconds: NOW,
      staleSeconds: STALE,
    });
    // 预筛的意义就是把 N 次 thread/turns/list 压到个位数（D18）
    expect(linux.map((t) => t.id)).toEqual(['t1']);

    // 降级路径按 updatedAt 阈值预筛，没有 path 的一律不入候选
    const fallback = selectCandidates({
      threads: [thread('t1', NOW - 1), thread('t2', NOW - STALE - 1), threads[2]!],
      heldRollouts: null,
      nowSeconds: NOW,
      staleSeconds: STALE,
    });
    expect(fallback.map((t) => t.id)).toEqual(['t1']);
  });

  // INV-001: design §6.1 的四个维度全组合，逐格与独立推导的谓词比对
  it('running_iff_no_terminal_record_and_owner_alive', () => {
    const statuses: Array<TurnStatus | 'none'> = [
      'inProgress',
      'interrupted',
      'completed',
      'failed',
      'none',
    ];
    const ownerships = ['held', 'not-held', 'undetectable'] as const;
    let runningCells = 0;
    let idleCells = 0;

    for (const status of statuses) {
      for (const completed of [true, false]) {
        for (const ownership of ownerships) {
          for (const fresh of [true, false]) {
            const updatedAt = fresh ? NOW - 1 : NOW - STALE - 1;
            const t = thread('t1', updatedAt);
            const turn =
              status === 'none'
                ? undefined
                : makeTurn({ id: 'turn-1', status, completedAt: completed ? NOW - 5 : null });

            const ids = computeRunningIds({
              threads: [t],
              turns: new Map([['t1', turn]]),
              heldRollouts:
                ownership === 'undetectable'
                  ? null
                  : ownership === 'held'
                    ? held('t1')
                    : held('other'),
              nowSeconds: NOW,
              staleSeconds: STALE,
            });

            // 独立推导的期望值：不复用被测实现的任何分支
            const noTerminalRecord =
              turn !== undefined &&
              !completed &&
              (status === 'inProgress' || status === 'interrupted');
            const ownerAlive =
              ownership === 'held' ? true : ownership === 'not-held' ? false : fresh;
            const expected = noTerminalRecord && ownerAlive;

            expect(
              ids.has('t1'),
              `status=${status} completedAt=${completed} owner=${ownership} fresh=${fresh}`,
            ).toBe(expected);

            if (expected) runningCells += 1;
            else idleCells += 1;
          }
        }
      }
    }

    // 反空转护栏：确认循环真的跑满了 5×2×3×2 格，且两类结论都出现过。
    // 运行格 = {inProgress, interrupted} × completedAt=null × (held×fresh 两格 + undetectable&fresh 一格) = 2×3 = 6
    expect(runningCells + idleCells).toBe(60);
    expect(runningCells).toBe(6);
    expect(idleCells).toBe(54);
  });
});
