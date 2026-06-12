const { Transaction, FedaPay } = require('fedapay');
FedaPay.setApiKey('sk_sandbox_xxxxx');
FedaPay.setEnvironment('sandbox');
async function test() {
  try {
    const t = await Transaction.create({
      amount: 100, currency: { iso: "XOF" }, customer: { email: "t@t.com" }
    });
    console.log("Transaction created:", t.id);
    const token = await t.generateToken();
    console.log("Token:", token.token);
    const res = await t.sendNowWithToken('mtn', token.token);
    console.log("Send Now Res:", res);
  } catch (e) {
    console.log("Error:", e.message, e.response?.data);
  }
}
test();
