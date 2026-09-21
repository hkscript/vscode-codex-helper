import { describe, expect, it } from 'vitest';

/**
 * Stubs for the 运行状态识别 requirement (test-plan T-001..T-011, INV-001).
 * Each case is completed by its build task before the implementation exists.
 */

describe('runningState', () => {
  it('marks_running_when_turn_in_progress_and_owner_alive', () => {
    expect.fail('TODO: implement marks_running_when_turn_in_progress_and_owner_alive');
  });

  it('marks_running_when_interrupted_without_completed_at_and_owner_alive', () => {
    expect.fail('TODO: implement marks_running_when_interrupted_without_completed_at_and_owner_alive');
  });

  it('not_running_when_latest_turn_has_terminal_record', () => {
    expect.fail('TODO: implement not_running_when_latest_turn_has_terminal_record');
  });

  it('not_running_when_no_live_owner_holds_rollout', () => {
    expect.fail('TODO: implement not_running_when_no_live_owner_holds_rollout');
  });

  it('stale_mtime_does_not_clear_running_when_owner_alive', () => {
    expect.fail('TODO: implement stale_mtime_does_not_clear_running_when_owner_alive');
  });

  it('not_running_when_thread_has_no_turns', () => {
    expect.fail('TODO: implement not_running_when_thread_has_no_turns');
  });

  it('missing_rollout_path_is_not_running_and_does_not_throw', () => {
    expect.fail('TODO: implement missing_rollout_path_is_not_running_and_does_not_throw');
  });

  it('turn_query_failure_isolates_to_that_session', () => {
    expect.fail('TODO: implement turn_query_failure_isolates_to_that_session');
  });

  it('fallback_marks_running_within_stale_threshold', () => {
    expect.fail('TODO: implement fallback_marks_running_within_stale_threshold');
  });

  it('fallback_clears_running_beyond_stale_threshold', () => {
    expect.fail('TODO: implement fallback_clears_running_beyond_stale_threshold');
  });

  it('candidates_exclude_sessions_not_held_by_any_process', () => {
    expect.fail('TODO: implement candidates_exclude_sessions_not_held_by_any_process');
  });

  // INV-001: design §6.1 全组合遍历
  it('running_iff_no_terminal_record_and_owner_alive', () => {
    expect.fail('TODO: implement running_iff_no_terminal_record_and_owner_alive');
  });
});
