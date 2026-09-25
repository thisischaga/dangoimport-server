const { cjConfig } = require('../../config/cj');

let activeRequests = 0;
const queue = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSlot() {
  if (activeRequests < cjConfig.maxConcurrentRequests) {
    activeRequests += 1;
    return;
  }

  await new Promise((resolve) => {
    queue.push(resolve);
  });
  activeRequests += 1;
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = queue.shift();
  if (next) next();
}

async function withRateLimit(fn) {
  await acquireSlot();
  try {
    if (cjConfig.requestDelayMs > 0) {
      await sleep(cjConfig.requestDelayMs);
    }
    return await fn();
  } finally {
    releaseSlot();
  }
}

module.exports = {
  withRateLimit,
  sleep,
};
