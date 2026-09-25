const mongoose = require('mongoose');

const state = {
  totalRequests: 0,
  requestsLastMinute: [],
  history: [],
  startedAt: Date.now(),
};

const HISTORY_SIZE = 60;

function trackRequest() {
  const now = Date.now();
  state.totalRequests += 1;
  state.requestsLastMinute.push(now);
  state.requestsLastMinute = state.requestsLastMinute.filter((t) => now - t < 60000);
}

function pushHistorySample() {
  const sample = {
    timestamp: new Date().toISOString(),
    requestsPerMinute: state.requestsLastMinute.length,
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };

  state.history.push(sample);
  if (state.history.length > HISTORY_SIZE) {
    state.history.shift();
  }
}

function startTrafficSampler() {
  pushHistorySample();
  setInterval(pushHistorySample, 5000);
}

function getTrafficMetrics() {
  const mem = process.memoryUsage();
  const dbState = mongoose.connection.readyState;
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: new Date(state.startedAt).toISOString(),
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    traffic: {
      totalRequests: state.totalRequests,
      requestsPerMinute: state.requestsLastMinute.length,
      history: state.history,
    },
    database: {
      status: dbStates[dbState] || 'unknown',
      ready: dbState === 1,
    },
    node: {
      version: process.version,
      platform: process.platform,
      pid: process.pid,
    },
  };
}

module.exports = {
  trackRequest,
  startTrafficSampler,
  getTrafficMetrics,
};
