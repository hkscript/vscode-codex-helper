import { describe, expect, it, vi } from 'vitest';
import { createSafeLogger } from '../../src/log';
import { createFakeLogChannel } from '../helpers/fakes';

describe('log', () => {
  it('forwards_each_level_to_the_same_level_of_the_sink', () => {
    const sink = createFakeLogChannel();
    const logger = createSafeLogger(sink);

    logger.info('a');
    logger.warn('b');
    logger.error('c');

    expect(sink.info).toHaveBeenCalledWith('a');
    expect(sink.warn).toHaveBeenCalledWith('b');
    expect(sink.error).toHaveBeenCalledWith('c');
  });

  // 通道释放之后再写会抛（真实 LogOutputChannel 的行为）：迟到的 stderr 不能炸到调用方
  it('swallows_writes_after_the_channel_has_been_closed', () => {
    const closed = () => {
      throw new Error('Channel has been closed');
    };
    const logger = createSafeLogger({ info: vi.fn(closed), warn: vi.fn(closed), error: vi.fn(closed) });

    expect(() => logger.info('late stderr')).not.toThrow();
    expect(() => logger.warn('late stderr')).not.toThrow();
    expect(() => logger.error('late stderr')).not.toThrow();
  });
});
