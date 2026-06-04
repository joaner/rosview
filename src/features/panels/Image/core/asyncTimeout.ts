export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onLateValue?: (value: T) => void,
): Promise<T> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      timer = null;
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timer != null) {
          clearTimeout(timer);
          timer = null;
        }
        if (timedOut) {
          onLateValue?.(value);
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        if (timer != null) {
          clearTimeout(timer);
          timer = null;
        }
        if (!timedOut) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  });
}
