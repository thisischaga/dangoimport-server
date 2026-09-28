const { fetchCjShippingOptionsForLines } = require('./cjFreightService');

async function calculateCJShipping(payload) {
  return fetchCjShippingOptionsForLines(payload);
}

module.exports = {
  calculateCJShipping,
};
