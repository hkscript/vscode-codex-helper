/**
 * 最多 `limit` 个 `fn` 同时在跑。`fn` 自己负责吞掉单项失败——这里任何一项 reject
 * 都会让整体 reject。`index` 让调用方按原顺序落结果，不受完成先后影响。
 */
export async function mapWithLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
}
