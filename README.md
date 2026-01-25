# Todo App

Proyecto de ejemplo (To-Do) para ejercicios personales y compartir en GitHub.

Instrucciones básicas:

1. Instalar dependencias:

```bash
npm install
```

2. Ejecutar en desarrollo:

```bash
npm run dev
# o
npm start
```

Notas importantes:

- No subas `database.db` al repositorio (está en `.gitignore`).
- En producción configura `NODE_ENV=production` y `PORT` y ajusta el origen CORS en `server.js`.
- El proyecto incluye un service worker (`public/sw.js`) para permitir carga offline del shell.

Mejoras recomendadas:

- Añadir manejo offline para operaciones POST/PUT/DELETE (Background Sync / queue).
- Añadir pruebas y CI.
- Añadir scripts de build y despliegue.
