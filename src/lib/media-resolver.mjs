// Limit signing bursts; transient failures must not become permanent missing assets.
export function createMediaResolver(sign, { concurrency = 6, attempts = 3, delay = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  let active = 0;
  const waiting = [];
  const pending = new Map();
  async function run(bucket, path) {
    if (active >= concurrency) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try {
      let last;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const value = await sign(bucket, path);
          if (!value) throw new Error('Asset signing returned no URL');
          return value;
        } catch (error) {
          last = error;
          if (attempt + 1 < attempts) await delay(250 * (attempt + 1));
        }
      }
      throw last;
    } finally {
      if (waiting.length) waiting.shift()();
      else active--;
    }
  }
  return (bucket, path) => {
    if (!path) return Promise.resolve('');
    const key = `${bucket}/${path}`;
    if (!pending.has(key)) pending.set(key, run(bucket, path).finally(() => pending.delete(key)));
    return pending.get(key);
  };
}
