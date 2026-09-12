const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'https://dangoimport.com',
  'https://www.dangoimport.com',
  'https://business.dangoimport.com',
  'https://dangoimport-admin-eiim.vercel.app',
  'https://site.dangoimport.com',
];

function parseEnvOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getAllowedOrigins() {
  const fromEnv = parseEnvOrigins();
  const merged = [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];

  if (process.env.NODE_ENV !== 'production') {
    merged.push('https://ddtyywq-dav228-8081.exp.direct');
  }

  return merged;
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'dangoimport.com' || hostname.endsWith('.dangoimport.com');
  } catch {
    return false;
  }
}

function createCorsOptions() {
  return {
    origin(origin, callback) {
      if (process.env.NODE_ENV === 'development') {
        return callback(null, true);
      }
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'X-App-Id',
      'X-App-Platform',
      'X-App-Version',
    ],
    exposedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
    optionsSuccessStatus: 200,
  };
}

module.exports = {
  getAllowedOrigins,
  isOriginAllowed,
  createCorsOptions,
};
