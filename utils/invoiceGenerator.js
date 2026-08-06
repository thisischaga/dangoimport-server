const PDFDocument = require('pdfkit');

const formatCurrency = (value = 0) => {
  const amount = Number(value) || 0;
  return amount.toLocaleString('fr-FR');
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const buildAddressText = (address = {}) => {
  const lines = [];
  if (address.fullAddress) lines.push(address.fullAddress);
  if (address.neighborhood) lines.push(address.neighborhood);
  const cityLine = [address.city, address.postalCode].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  if (address.country) lines.push(address.country);
  if (address.instructions) lines.push(`Instructions: ${address.instructions}`);
  return lines.join('\n') || 'Adresse non renseignée';
};

const streamOrderInvoicePdf = (res, order, options = {}) => {
  const fileName = options.fileName || `invoice-${order.orderNumber || order._id || 'order'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).font('Helvetica-Bold').text('Facture DangoImport', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#444444');
  doc.text(`N° commande : ${order.orderNumber || order._id}`);
  doc.text(`Date : ${formatDate(order.createdAt || order.paymentDate || new Date())}`);
  doc.text(`Client : ${order.customerName || '—'}`);
  doc.text(`Email : ${order.customerEmail || '—'}`);
  doc.text(`Téléphone : ${order.customerPhone || '—'}`);
  doc.moveDown();

  doc.font('Helvetica-Bold').text('Adresse de livraison');
  doc.font('Helvetica').text(buildAddressText(order.shippingAddress));
  doc.moveDown();

  doc.font('Helvetica-Bold').text('Détails des articles');
  doc.moveDown(0.2);

  const items = Array.isArray(order.items) ? order.items : [];
  items.forEach((item, index) => {
    const name = item.productName || item.name || 'Article';
    const qty = item.quantity || 1;
    const price = Number(item.price || 0);
    const subtotal = Number(item.subtotal || price * qty || 0);

    doc.font('Helvetica-Bold').text(`${index + 1}. ${name} (x${qty})`, { continued: true });
    doc.font('Helvetica').text(`  ${formatCurrency(subtotal)} FCFA`);
    doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`Prix unitaire : ${formatCurrency(price)} FCFA`, { indent: 20 });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#444444');
  });

  doc.moveDown();
  doc.font('Helvetica-Bold').text('Résumé de la commande');
  doc.moveDown(0.2);
  const subtotal = Number(order.subtotal || order.productPrice || 0);
  const shippingCost = Number(order.shippingCost || order.deliveryFee || 0);
  const discount = Number(order.discount || 0);
  const tax = Number(order.tax || 0);
  const total = Number(order.total || order.totalPrice || 0);

  doc.font('Helvetica').text(`Sous-total : ${formatCurrency(subtotal)} FCFA`);
  doc.text(`Livraison : ${formatCurrency(shippingCost)} FCFA`);
  if (discount) doc.text(`Réduction : -${formatCurrency(discount)} FCFA`);
  if (tax) doc.text(`Taxes : ${formatCurrency(tax)} FCFA`);
  doc.font('Helvetica-Bold').text(`Total : ${formatCurrency(total)} FCFA`);
  doc.moveDown();

  doc.font('Helvetica-Bold').text('Paiement');
  doc.font('Helvetica').text(`Statut : ${order.paymentStatus || order.status || '—'}`);
  doc.text(`Méthode : ${order.paymentMethod || '—'}`);
  doc.moveDown();

  doc.font('Helvetica').fontSize(9).fillColor('#777777').text('Merci pour votre achat sur DangoImport.', { align: 'center' });

  doc.end();
};

module.exports = {
  streamOrderInvoicePdf,
};
