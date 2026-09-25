# Dropshipping API — Dango Import

Base URL admin: `/api/admin/products/dropshipping`

Auth: `Authorization: Bearer <adminToken>`

## Variables d'environnement

Aucune variable spécifique dropshipping obligatoire pour la phase MANUAL/CSV.

Variables existantes requises:

- `MONGODB_URI` — connexion MongoDB
- `JWT_SECRET` — authentification admin
- `FEDAPAY_SECRET_KEY` / `FEDAPAY_PUBLIC_KEY` — checkout client (inchangé)

Variables futures (architecture fournisseurs, non implémentées):

- `ALIBABA_API_KEY`
- `ALIEXPRESS_API_KEY`
- `DROPSHIPPING_SYNC_CRON`

## Endpoints

### Lister les produits dropshipping

```http
GET /api/admin/products/dropshipping?page=1&limit=20&search=phone&active=true
```

### Créer un produit dropshipping

```http
POST /api/admin/products/dropshipping
Content-Type: application/json

{
  "name": "Montre connectée",
  "description": "Montre sport étanche",
  "category": "Accessoires",
  "subCategory": "Montres",
  "price": 25000,
  "stock": 50,
  "isPublished": true,
  "isDropshippingActive": true,
  "otherCosts": 500,
  "supplier": {
    "name": "Shenzhen Tech Co.",
    "platform": "manual",
    "productId": "SKU-99821",
    "productUrl": "https://example.com/product/99821",
    "supplierPrice": 12000,
    "supplierCurrency": "XOF",
    "shippingCost": 3500,
    "estimatedDeliveryDays": 12
  },
  "variants": [
    { "name": "Noir", "price": 25000, "stock": 25, "isDefault": true },
    { "name": "Argent", "price": 25500, "stock": 25 }
  ]
}
```

### Prévisualiser la marge

```http
POST /api/admin/products/dropshipping/preview-margin
Content-Type: application/json

{
  "price": 25000,
  "supplierPrice": 12000,
  "supplierShippingCost": 3500,
  "otherCosts": 500
}
```

Réponse:

```json
{
  "success": true,
  "data": {
    "totalCost": 16000,
    "estimatedProfit": 9000,
    "marginPercent": 36
  }
}
```

### Import CSV

```http
POST /api/admin/products/dropshipping/import/csv
Content-Type: application/json

{
  "csv": "name,description,category,price,stock,supplierPlatform,supplierProductId,supplierPrice,shippingCost\nMontre,Montre sport,Accessoires,25000,10,manual,SKU-1,12000,3500"
}
```

### Mettre à jour le statut

```http
PATCH /api/admin/products/dropshipping/:id/status
Content-Type: application/json

{
  "isDropshippingActive": true,
  "isPublished": true
}
```

### Synchroniser un produit

```http
POST /api/admin/products/dropshipping/:id/sync
```

### Commander chez le fournisseur (manuel)

```http
POST /api/admin/products/dropshipping/orders/:orderId/items/:itemIndex/supplier-order
Content-Type: application/json

{
  "note": "Commande passée sur Alibaba le 25/09/2026"
}
```

### Filtrer les commandes admin par source

```http
GET /api/admin/orders/history?orderSource=DROPSHIPPING
GET /api/admin/orders/history?orderSource=LOCAL_SELLER
```

## Données jamais exposées au client public

- `supplier.supplierPrice`
- `supplier.productUrl`
- `supplier.productId`
- `estimatedProfit`
- `marginPercent`
- `otherCosts`
- `syncError`

Les réponses publiques `/api/products` passent par `toPublicProduct()`.

## Statuts d'approvisionnement dropshipping

`PENDING_PAYMENT`, `PAID`, `SUPPLIER_ORDER_PENDING`, `SUPPLIER_ORDERED`, `IN_TRANSIT`, `RECEIVED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`
