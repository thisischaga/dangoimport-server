# Intégration CJdropshipping (backend)

## Variables d'environnement

```env
CJ_API_BASE_URL=https://developers.cjdropshipping.com
CJ_ACCESS_TOKEN=
CJ_API_ENABLED=true
CJ_IMPORT_BATCH_SIZE=100
CJ_SYNC_ENABLED=true
CJ_DEFAULT_MARGIN_PERCENT=30
CJ_MAX_CONCURRENT_REQUESTS=1
CJ_REQUEST_DELAY_MS=1000
CJ_REQUEST_TIMEOUT_MS=30000
CJ_MAX_RETRIES=2
```

Ne jamais exposer `CJ_ACCESS_TOKEN` au frontend ni le committer.

## Obtenir un token

1. Créer un compte sur [CJdropshipping](https://www.cjdropshipping.com/).
2. Ouvrir le portail développeur : [developers.cjdropshipping.com](https://developers.cjdropshipping.com/).
3. Générer un **Access Token** API et le coller dans `CJ_ACCESS_TOKEN` sur le serveur.
4. Mettre `CJ_API_ENABLED=true` puis redémarrer le backend.

## Endpoints admin (JWT admin requis)

| Méthode | Route | Description |
|--------|--------|-------------|
| GET | `/api/admin/suppliers/cj/status` | Statut config + stats catalogue |
| POST | `/api/admin/suppliers/cj/test` | Test connexion (`listV2` page 1) |
| GET | `/api/admin/suppliers/cj/products` | Recherche catalogue CJ (proxy) |
| POST | `/api/admin/suppliers/cj/import` | Import paginé async `{ pages, size, keyword, ... }` |
| POST | `/api/admin/suppliers/cj/import-selected` | `{ productIds: [] }` |
| POST | `/api/admin/suppliers/cj/sync` | Sync stock/prix produits déjà importés |
| GET | `/api/admin/suppliers/cj/sync-status` | Dernier job ou `?jobId=` |
| GET | `/api/admin/suppliers/cj/logs` | Historique jobs |

## Import

- Déclenché **uniquement** par l’admin (pas d’import auto au démarrage).
- Jobs stockés dans `SupplierSyncJob` (MongoDB), exécution en arrière-plan via `setImmediate`.
- Upsert par clé `externalSourceKey` (`cj:{pid}`) et index `(supplier.platform, supplier.productId)`.

## Limitations API CJ

- Quotas / points API : respecter `CJ_MAX_CONCURRENT_REQUESTS` et `CJ_REQUEST_DELAY_MS`.
- Pagination `listV2` : max 100 par page.
- Erreurs 401/403/429 gérées dans `cjClient` avec retry limité sur timeout/5xx/429.

## Tests

```bash
npm test
```

Les tests unitaires mockent le client HTTP (pas d’appels réels sans token).
