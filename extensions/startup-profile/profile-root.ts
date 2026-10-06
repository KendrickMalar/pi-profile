import { isAbsolute, join, resolve } from 'node:path';

/** Resolve one user-owned root. Never fall back to the bundled samples. */
export function resolveProfileRoot(input: { home: string; override?: string }): { directory?: string; warning?: string } {
  const { home, override } = input;
  if (!isAbsolute(home) || /[\x00-\x1f\x7f]/.test(home)) {
    return { warning: 'Profile用のホームディレクトリが不正です。追加指示なしOtherで開きます。' };
  }
  if (override === undefined || override === '') {
    return { directory: join(home, '.pi', 'agent', 'profiles') };
  }
  if (!override.trim() || /[\x00-\x1f\x7f]/.test(override) || (!isAbsolute(override) && !override.startsWith('~/'))) {
    return { warning: 'PI_PROFILE_DIRは絶対パスまたは~/で指定してください。追加指示なしOtherで開きます。' };
  }
  return { directory: override.startsWith('~/') ? join(home, override.slice(2)) : resolve(override) };
}
