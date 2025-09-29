// sidepanel/modules/utils.js

/**
 * Creates a debounced function that delays invoking func until after
 * 'wait' milliseconds have elapsed since the last time it was invoked
 */
export function debounce(func, wait) {
  let timeoutId;

  return function debounced(...args) {
    // Clear any existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Set a new timeout
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

// Alternative: Return a promise-based version
export function debounceAsync(func, wait) {
  let timeoutId;
  let resolvePromise;

  return function debounced(...args) {
    return new Promise((resolve) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      resolvePromise = resolve;

      timeoutId = setTimeout(async () => {
        const result = await func.apply(this, args);
        resolvePromise(result);
      }, wait);
    });
  };
}
