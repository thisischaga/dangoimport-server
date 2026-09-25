class SupplierProvider {
  constructor(platform = 'manual') {
    this.platform = platform;
  }

  async getProduct() {
    throw new Error(`${this.platform}: getProduct() non implémenté.`);
  }

  async getStock() {
    throw new Error(`${this.platform}: getStock() non implémenté.`);
  }

  async getPrice() {
    throw new Error(`${this.platform}: getPrice() non implémenté.`);
  }

  async createOrder() {
    throw new Error(`${this.platform}: createOrder() non implémenté.`);
  }

  async getOrderStatus() {
    throw new Error(`${this.platform}: getOrderStatus() non implémenté.`);
  }
}

module.exports = SupplierProvider;
