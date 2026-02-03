require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_cambiar_en_produccion';

app.use(cors({
  origin: [
    'https://sunny-babka-8a1b11.netlify.app',
    'http://localhost:3000',
    'https://todoapp-production-9176.up.railway.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
}));
app.use(express.json());

// Servir frontend estático
app.use(express.static(path.join(__dirname, 'public')));

// Ruta raíz -> index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// DB (archivo local - usar /tmp en Railway para escritura)
const dbPath = process.env.RAILWAY_ENVIRONMENT ? '/tmp/database.db' : './database.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error opening DB:', err.message);
  else console.log('Database connected at:', dbPath);
});

// Palabras que marcan una tarea como "de comida" (botón calorías)
const FOOD_KEYWORDS = ['almuerzo', 'cena', 'comer', 'comida', 'desayuno', 'media mañana', 'once'];
function isFoodTask(title) {
  if (!title || typeof title !== 'string') return 0;
  const t = title.toLowerCase().trim();
  return FOOD_KEYWORDS.some(kw => t.includes(kw)) ? 1 : 0;
}

// Palabras que marcan una tarea como "de lectura" (botón libro)
const READING_KEYWORDS = ['libro', 'leer'];
function isReadingTask(title) {
  if (!title || typeof title !== 'string') return 0;
  const t = title.toLowerCase().trim();
  return READING_KEYWORDS.some(kw => t.includes(kw)) ? 1 : 0;
}

// Palabras que marcan una tarea como "gym/entrenamiento" (botón 💪)
const GYM_KEYWORDS = ['gym', 'deporte', 'correr', 'pesas', 'gimnasio', 'crossfit', 'cross', 'pechamen', 'espalda', 'piernas', 'ejercicio', 'entrenar'];
function isGymTask(title) {
  if (!title || typeof title !== 'string') return 0;
  const t = title.toLowerCase().trim();
  return GYM_KEYWORDS.some(kw => t.includes(kw)) ? 1 : 0;
}

// Palabras que marcan una tarea como "lista de compras" (botón 🛒)
const SHOPPING_KEYWORDS = ['compras', 'comprar', 'supermercado', 'super', 'feria', 'mall', 'chino'];
function isShoppingTask(title) {
  if (!title || typeof title !== 'string') return 0;
  const t = title.toLowerCase().trim();
  return SHOPPING_KEYWORDS.some(kw => t.includes(kw)) ? 1 : 0;
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      is_food_task INTEGER DEFAULT 0,
      is_reading_task INTEGER DEFAULT 0,
      is_gym_task INTEGER DEFAULT 0,
      is_shopping_task INTEGER DEFAULT 0,
      date TEXT,
      FOREIGN KEY (user_id) REFERENCES usuarios(id)
    )
  `);
  
  // Migración: agregar user_id si falta
  db.all("PRAGMA table_info(tasks)", (err, columns) => {
    if (err) {
      console.error('Error checking table structure:', err);
      return;
    }
    
    const hasUserId = columns.some(col => col.name === 'user_id');
    
    if (!hasUserId) {
      console.log('Migrating: Adding user_id column to tasks table...');
      db.run(`ALTER TABLE tasks ADD COLUMN user_id INTEGER`, (err) => {
        if (err) console.error('Migration error:', err.message);
        else {
          console.log('Migration: user_id column added');
          db.run(`DELETE FROM tasks WHERE user_id IS NULL`, () => {});
        }
      });
    }
    // Migración: agregar is_food_task si falta
    const hasFoodTask = columns.some(col => col.name === 'is_food_task');
    if (!hasFoodTask) {
      console.log('Migrating: Adding is_food_task column to tasks...');
      db.run(`ALTER TABLE tasks ADD COLUMN is_food_task INTEGER DEFAULT 0`, (err) => {
        if (err) console.error('Migration is_food_task:', err.message);
        else console.log('Migration: is_food_task column added');
      });
    }
    // Migración: agregar is_reading_task si falta
    const hasReadingTask = columns.some(col => col.name === 'is_reading_task');
    if (!hasReadingTask) {
      console.log('Migrating: Adding is_reading_task column to tasks...');
      db.run(`ALTER TABLE tasks ADD COLUMN is_reading_task INTEGER DEFAULT 0`, (err) => {
        if (err) console.error('Migration is_reading_task:', err.message);
        else console.log('Migration: is_reading_task column added');
      });
    }
    // Migración: agregar is_gym_task si falta
    const hasGymTask = columns.some(col => col.name === 'is_gym_task');
    if (!hasGymTask) {
      console.log('Migrating: Adding is_gym_task column to tasks...');
      db.run(`ALTER TABLE tasks ADD COLUMN is_gym_task INTEGER DEFAULT 0`, (err) => {
        if (err) console.error('Migration is_gym_task:', err.message);
        else console.log('Migration: is_gym_task column added');
      });
    }
    // Migración: agregar date (fecha del día de la tarea, YYYY-MM-DD) si falta
    const hasDate = columns.some(col => col.name === 'date');
    if (!hasDate) {
      console.log('Migrating: Adding date column to tasks...');
      db.run(`ALTER TABLE tasks ADD COLUMN date TEXT`, (err) => {
        if (err) console.error('Migration date:', err.message);
        else {
          console.log('Migration: date column added');
          db.run(`UPDATE tasks SET date = date(created_at) WHERE date IS NULL`, () => {});
        }
      });
    }
    // Migración: agregar is_shopping_task si falta
    const hasShoppingTask = columns.some(col => col.name === 'is_shopping_task');
    const runBackfill = () => {
      db.all('SELECT id, title, is_food_task, is_reading_task, is_gym_task, is_shopping_task FROM tasks', [], (errBackfill, rows) => {
        if (errBackfill || !rows || !rows.length) return;
        const toUpdate = rows.filter((r) => {
          const wantFood = isFoodTask(r.title) ? 1 : 0;
          const wantReading = isReadingTask(r.title) ? 1 : 0;
          const wantGym = isGymTask(r.title) ? 1 : 0;
          const wantShopping = isShoppingTask(r.title) ? 1 : 0;
          const curFood = r.is_food_task == null ? 0 : Number(r.is_food_task);
          const curReading = r.is_reading_task == null ? 0 : Number(r.is_reading_task);
          const curGym = r.is_gym_task == null ? 0 : Number(r.is_gym_task);
          const curShopping = r.is_shopping_task == null ? 0 : Number(r.is_shopping_task);
          return curFood !== wantFood || curReading !== wantReading || curGym !== wantGym || curShopping !== wantShopping;
        });
        toUpdate.forEach((r) => {
          db.run('UPDATE tasks SET is_food_task = ?, is_reading_task = ?, is_gym_task = ?, is_shopping_task = ? WHERE id = ?', [isFoodTask(r.title) ? 1 : 0, isReadingTask(r.title) ? 1 : 0, isGymTask(r.title) ? 1 : 0, isShoppingTask(r.title) ? 1 : 0, r.id]);
        });
        if (toUpdate.length > 0) console.log('Backfill is_food_task/is_reading_task/is_gym_task/is_shopping_task: actualizadas', toUpdate.length, 'tareas existentes');
      });
    };
    if (!hasShoppingTask) {
      console.log('Migrating: Adding is_shopping_task column to tasks...');
      db.run(`ALTER TABLE tasks ADD COLUMN is_shopping_task INTEGER DEFAULT 0`, (err) => {
        if (err) console.error('Migration is_shopping_task:', err.message);
        else {
          console.log('Migration: is_shopping_task column added');
          runBackfill();
        }
      });
    } else {
      runBackfill();
    }
  });
});


db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      edad INTEGER,
      correo TEXT,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES usuarios(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS meal_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      meal_type TEXT NOT NULL,
      foods_text TEXT,
      calories REAL,
      protein REAL,
      carbs REAL,
      fat REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (user_id) REFERENCES usuarios(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS gym_progress (
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      routine_text TEXT,
      duration_min INTEGER,
      series INTEGER,
      seconds_per_set INTEGER,
      rest_seconds INTEGER,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (task_id, user_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (user_id) REFERENCES usuarios(id)
    )
  `);
  db.all('PRAGMA table_info(gym_progress)', [], (err, cols) => {
    const names = (cols || []).map(c => c.name);
    if (!names.includes('series')) db.run('ALTER TABLE gym_progress ADD COLUMN series INTEGER', () => {});
    if (!names.includes('seconds_per_set')) db.run('ALTER TABLE gym_progress ADD COLUMN seconds_per_set INTEGER', () => {});
    if (!names.includes('rest_seconds')) db.run('ALTER TABLE gym_progress ADD COLUMN rest_seconds INTEGER', () => {});
    if (!names.includes('completed_at')) db.run('ALTER TABLE gym_progress ADD COLUMN completed_at TEXT', () => {});
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS reading_progress (
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      book_title TEXT,
      current_page INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (task_id, user_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (user_id) REFERENCES usuarios(id)
    )
  `);
  db.all('PRAGMA table_info(reading_progress)', [], (err, cols) => {
    const names = (cols || []).map(c => c.name);
    if (!names.includes('total_pages')) db.run('ALTER TABLE reading_progress ADD COLUMN total_pages INTEGER', () => {});
    if (!names.includes('notes')) db.run('ALTER TABLE reading_progress ADD COLUMN notes TEXT', () => {});
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS shopping_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      item_text TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (user_id) REFERENCES usuarios(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      calories_per_100 REAL NOT NULL DEFAULT 0,
      protein_per_100 REAL NOT NULL DEFAULT 0,
      carbs_per_100 REAL NOT NULL DEFAULT 0,
      fat_per_100 REAL NOT NULL DEFAULT 0
    )
  `);
  // Seed básico de alimentos (por 100 g) si la tabla está vacía; luego arranca el servidor
  db.get('SELECT COUNT(*) as n FROM foods', [], (err, row) => {
    const n = (row && row.n) || 0;
    if (err) {
      startHttpServer();
      return;
    }
    if (n > 0) {
      console.log('Foods: tabla ya tiene', n, 'alimentos');
      startHttpServer();
      return;
    }
    const seed = [
      ['arroz', 130, 2.7, 28, 0.3],
      ['pollo', 165, 31, 0, 3.6],
      ['huevo', 155, 13, 1.1, 11],
      ['leche', 42, 3.4, 5, 1],
      ['pan', 265, 9, 49, 3.2],
      ['manzana', 52, 0.3, 14, 0.2],
      ['plátano', 89, 1.1, 23, 0.3],
      ['pasta', 131, 5, 25, 1.1],
      ['carne vaca', 250, 26, 0, 15],
      ['atún', 132, 28, 0, 1],
      ['queso', 402, 25, 1.3, 33],
      ['aceite oliva', 884, 0, 0, 100],
      ['tomate', 18, 0.9, 3.9, 0.2],
      ['lechuga', 15, 1.4, 2.9, 0.2],
      ['arroz integral', 112, 2.6, 24, 0.9],
      ['pavo', 135, 29, 0, 1.5],
      ['salmon', 208, 20, 0, 13],
      ['avena', 389, 17, 66, 6.9],
      ['yogur', 59, 10, 3.6, 0.4],
      ['arroz blanco', 130, 2.7, 28, 0.3]
    ];
    const stmt = db.prepare('INSERT INTO foods (name, calories_per_100, protein_per_100, carbs_per_100, fat_per_100) VALUES (?, ?, ?, ?, ?)');
    seed.forEach(([name, cal, p, c, f]) => stmt.run(name, cal, p, c, f));
    stmt.finalize(() => {
      console.log('Seed foods: insertados', seed.length, 'alimentos');
      startHttpServer();
    });
  });
});

// ============ AUTENTICACIÓN ============

// Middleware para verificar JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    req.user = user;
    next();
  });
};

// Función para validar contraseña segura
function validatePassword(password) {
  const errors = [];
  
  if (password.length < 8) {
    errors.push('Mínimo 8 caracteres');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Al menos una mayúscula');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Al menos una minúscula');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Al menos un número');
  }
  if (!/[!@#$%^&*(),.?":{}|<>_\-]/.test(password)) {
    errors.push('Al menos un símbolo (!@#$%^&*...)');
  }
  
  return errors;
}

// Registro de usuario
app.post('/register', async (req, res) => {
  const { nombre, password, correo } = req.body;
  
  if (!nombre || !password) {
    return res.status(400).json({ error: 'Nombre y contraseña son requeridos' });
  }

  // Validar nombre de usuario
  if (nombre.length < 3) {
    return res.status(400).json({ error: 'El nombre debe tener al menos 3 caracteres' });
  }

  // Validar contraseña segura
  const passwordErrors = validatePassword(password);
  if (passwordErrors.length > 0) {
    return res.status(400).json({ 
      error: 'Contraseña no segura', 
      details: passwordErrors 
    });
  }

  try {
    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);
    const createdAt = new Date().toISOString();

    db.run(
      'INSERT INTO usuarios (nombre, password, correo, created_at) VALUES (?, ?, ?, ?)',
      [nombre, hashedPassword, correo || null, createdAt],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'El usuario ya existe' });
          }
          return res.status(500).json({ error: 'Error al crear usuario' });
        }
        res.status(201).json({ message: 'Usuario creado exitosamente', id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Login
app.post('/login', (req, res) => {
  const { nombre, password } = req.body;

  if (!nombre || !password) {
    return res.status(400).json({ error: 'Nombre y contraseña son requeridos' });
  }

  db.get('SELECT * FROM usuarios WHERE nombre = ?', [nombre], async (err, user) => {
    if (err) {
      console.error('Error en consulta de login:', err);
      return res.status(500).json({ error: 'Error del servidor' });
    }

    if (!user) {
      console.log('Usuario no encontrado:', nombre);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    try {
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
        console.log('Contraseña incorrecta para usuario:', nombre);
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }

      // Crear token JWT (expira en 7 días)
      const token = jwt.sign(
        { id: user.id, nombre: user.nombre },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({ 
        message: 'Login exitoso',
        token,
        user: { id: user.id, nombre: user.nombre, correo: user.correo }
      });
    } catch (err) {
      res.status(500).json({ error: 'Error del servidor' });
    }
  });
});

// Verificar token (útil para el frontend)
app.get('/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ============ RECUPERAR CONTRASEÑA ============
function getMailTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

app.post('/forgot-password', (req, res) => {
  const email = (req.body && req.body.email) ? String(req.body.email).trim().toLowerCase() : '';
  const genericMessage = 'Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.';

  if (!email) {
    return res.status(400).json({ error: 'El correo es requerido.', message: genericMessage });
  }

  db.get('SELECT id, nombre FROM usuarios WHERE LOWER(TRIM(correo)) = ?', [email], (err, user) => {
    if (err) {
      console.error('Error buscando usuario por correo:', err);
      return res.status(200).json({ message: genericMessage });
    }
    if (!user) {
      return res.status(200).json({ message: genericMessage });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const createdAt = now.toISOString();
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    const resetLink = baseUrl ? `${baseUrl}/reset-password.html?token=${token}` : `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;

    db.run(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)',
      [user.id, token, expiresAt, createdAt],
      function (insertErr) {
        if (insertErr) {
          console.error('Error guardando token de reseteo:', insertErr);
          return res.status(200).json({ message: genericMessage });
        }

        const transporter = getMailTransporter();
        if (!transporter) {
          console.warn('SMTP no configurado (BASE_URL, SMTP_*). No se envía correo.');
          return res.status(200).json({ message: genericMessage });
        }

        console.log('Enviando correo de recuperación a:', email);
        const mailOptions = {
          from: process.env.SMTP_USER || 'noreply@fluxlist.app',
          to: email,
          subject: 'Restablece tu contraseña - FluxList',
          text: `Hola,\n\nRecibimos una solicitud para restablecer la contraseña de tu cuenta FluxList.\n\nHaz clic en el siguiente enlace (válido 1 hora):\n${resetLink}\n\nSi no solicitaste esto, ignora este correo.\n\n— FluxList`,
          html: `<p>Hola,</p><p>Recibimos una solicitud para restablecer la contraseña de tu cuenta FluxList.</p><p><a href="${resetLink}">Restablecer contraseña</a></p><p>Si el enlace no funciona, copia y pega en el navegador:</p><p>${resetLink}</p><p>Válido 1 hora. Si no solicitaste esto, ignora este correo.</p><p>— FluxList</p>`
        };

        transporter.sendMail(mailOptions, (mailErr) => {
          if (mailErr) {
            console.error('Error enviando correo:', mailErr.message || mailErr);
          } else {
            console.log('Correo de recuperación enviado correctamente a:', email);
          }
          res.status(200).json({ message: genericMessage });
        });
      }
    );
  });
});

app.get('/reset-password/validate', (req, res) => {
  const token = (req.query && req.query.token) ? String(req.query.token).trim() : '';
  if (!token) return res.status(400).json({ valid: false });

  db.get(
    'SELECT id FROM password_reset_tokens WHERE token = ? AND expires_at > datetime(\'now\')',
    [token],
    (err, row) => {
      if (err) return res.status(500).json({ valid: false });
      res.json({ valid: !!row });
    }
  );
});

app.post('/reset-password', async (req, res) => {
  const { token, newPassword, confirmPassword } = req.body || {};
  const tokenStr = token ? String(token).trim() : '';
  const newPass = newPassword ? String(newPassword) : '';
  const confirmPass = confirmPassword ? String(confirmPassword) : '';

  if (!tokenStr) {
    return res.status(400).json({ error: 'Token requerido.' });
  }
  if (newPass !== confirmPass) {
    return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
  }
  const passwordErrors = validatePassword(newPass);
  if (passwordErrors.length > 0) {
    return res.status(400).json({ error: 'Contraseña no cumple los requisitos.', details: passwordErrors });
  }

  db.get(
    'SELECT id, user_id FROM password_reset_tokens WHERE token = ? AND expires_at > datetime(\'now\')',
    [tokenStr],
    async (err, row) => {
      if (err) return res.status(500).json({ error: 'Error del servidor.' });
      if (!row) return res.status(400).json({ error: 'Enlace inválido o expirado.' });

      try {
        const hashedPassword = await bcrypt.hash(newPass, 10);
        db.run('UPDATE usuarios SET password = ? WHERE id = ?', [hashedPassword, row.user_id], (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Error al actualizar contraseña.' });
          db.run('DELETE FROM password_reset_tokens WHERE id = ?', [row.id], () => {});
          res.status(200).json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
        });
      } catch (e) {
        res.status(500).json({ error: 'Error del servidor.' });
      }
    }
  );
});

// Endpoint temporal de debug (eliminar en producción)
app.get('/debug/users', (req, res) => {
  db.all('SELECT id, nombre, correo, created_at FROM usuarios', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'DB error', details: err.message });
    }
    res.json({ count: rows.length, users: rows });
  });
});

// ============ ENDPOINTS DE TAREAS ============
// Todas las rutas de tareas requieren autenticación
app.get('/tasks', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const dateParam = (req.query.date || '').trim();
  if (process.env.DEBUG_TASKS) console.log('[tasks] user_id=', userId, 'date=', dateParam || '(all)');

  if (dateParam) {
    // Vista por día: tareas de esa fecha con meal_logs, reading_progress, gym_progress
    const sql = `
      SELECT t.*, r.book_title, r.current_page,
        g.routine_text AS gym_routine, g.duration_min AS gym_duration_min,
        g.series AS gym_series, g.seconds_per_set AS gym_seconds_per_set, g.rest_seconds AS gym_rest_seconds, g.completed_at AS gym_completed_at
      FROM tasks t
      LEFT JOIN reading_progress r ON t.id = r.task_id AND t.user_id = r.user_id
      LEFT JOIN gym_progress g ON t.id = g.task_id AND t.user_id = g.user_id
      WHERE t.user_id = ? AND (t.date = ? OR (t.date IS NULL AND date(t.created_at) = ?))
      ORDER BY t.start_time ASC, t.created_at ASC`;
    db.all(sql, [userId, dateParam, dateParam], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      const taskIds = (rows || []).map(r => r.id).filter(Boolean);
      if (taskIds.length === 0) return res.json([]);
      const placeholders = taskIds.map(() => '?').join(',');
      db.all(
        `SELECT task_id, meal_type, foods_text, calories, protein, carbs, fat, created_at
         FROM meal_logs WHERE task_id IN (${placeholders}) AND user_id = ? ORDER BY created_at ASC`,
        [...taskIds, userId],
        (err2, mealRows) => {
          if (err2) return res.status(500).json({ error: 'DB error' });
          const byTask = {};
          (mealRows || []).forEach(m => {
            if (!byTask[m.task_id]) byTask[m.task_id] = [];
            byTask[m.task_id].push(m);
          });
          rows.forEach(t => { t.meal_logs = byTask[t.id] || []; });
          // Poblar last_* desde el meal_log más reciente para que el front muestre calorías en la barra
          rows.forEach(t => {
            const logs = t.meal_logs || [];
            const last = logs[logs.length - 1];
            if (last) {
              t.last_meal_type = last.meal_type;
              t.last_calories = last.calories;
              t.last_protein = last.protein;
              t.last_carbs = last.carbs;
              t.last_fat = last.fat;
            }
          });
          res.json(rows);
        }
      );
    });
    return;
  }

  db.all(
    `SELECT t.*, r.book_title, r.current_page,
       g.routine_text AS gym_routine, g.duration_min AS gym_duration_min,
       g.series AS gym_series, g.seconds_per_set AS gym_seconds_per_set, g.rest_seconds AS gym_rest_seconds, g.completed_at AS gym_completed_at
     FROM tasks t
     LEFT JOIN reading_progress r ON t.id = r.task_id AND t.user_id = r.user_id
     LEFT JOIN gym_progress g ON t.id = g.task_id AND t.user_id = g.user_id
     WHERE t.user_id = ?
     ORDER BY t.id DESC`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      db.all(
        'SELECT task_id, meal_type, calories, protein, carbs, fat, created_at FROM meal_logs WHERE user_id = ? ORDER BY task_id, created_at DESC',
        [userId],
        (err2, logs) => {
          if (err2) return res.status(500).json({ error: 'DB error' });
          const lastByTask = {};
          for (const log of logs || []) {
            if (lastByTask[log.task_id] == null) lastByTask[log.task_id] = log;
          }
          rows.forEach(t => {
            const m = lastByTask[t.id];
            if (m) {
              t.last_meal_type = m.meal_type;
              t.last_calories = m.calories;
              t.last_protein = m.protein;
              t.last_carbs = m.carbs;
              t.last_fat = m.fat;
            }
          });
          db.all(
            'SELECT task_id, COUNT(*) AS cnt FROM shopping_list_items WHERE user_id = ? GROUP BY task_id',
            [userId],
            (err3, shopRows) => {
              const shopByTask = {};
              if (!err3 && shopRows) shopRows.forEach(r => { shopByTask[r.task_id] = r.cnt; });
              rows.forEach(t => { t.shopping_count = shopByTask[t.id] || 0; });
              res.json(rows);
            }
          );
        }
      );
    }
  );
});

app.post('/tasks', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const title = (req.body.title || '').trim();
  const start_time = req.body.start_time || null;
  const end_time = req.body.end_time || null;
  if (!title) return res.status(400).json({ error: 'title required' });
  const createdAt = new Date().toISOString();
  const date = (req.body.date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) ? req.body.date : createdAt.slice(0, 10);
  const is_food_task = isFoodTask(title) ? 1 : 0;
  const is_reading_task = isReadingTask(title) ? 1 : 0;
  const is_gym_task = isGymTask(title) ? 1 : 0;
  const is_shopping_task = isShoppingTask(title) ? 1 : 0;
  db.run(
    'INSERT INTO tasks (user_id, title, completed, created_at, start_time, end_time, is_food_task, is_reading_task, is_gym_task, is_shopping_task, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [userId, title, 0, createdAt, start_time, end_time, is_food_task, is_reading_task, is_gym_task, is_shopping_task, date],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.status(201).json({
        id: this.lastID,
        user_id: userId,
        title,
        completed: 0,
        created_at: createdAt,
        start_time,
        end_time,
        is_food_task,
        is_reading_task,
        is_gym_task,
        is_shopping_task,
        date,
      });
    }
  );
});

app.patch('/tasks/:id', authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user.id;
  const completed = req.body.completed ? 1 : 0;
  db.run('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?', [completed, id, userId], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.sendStatus(204);
  });
});

app.put('/tasks/:id', authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user.id;
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  const is_food_task = isFoodTask(title) ? 1 : 0;
  const is_reading_task = isReadingTask(title) ? 1 : 0;
  const is_gym_task = isGymTask(title) ? 1 : 0;
  const is_shopping_task = isShoppingTask(title) ? 1 : 0;
  const dateParam = req.body.date;
  const date = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) ? dateParam : null;
  const updates = date !== null
    ? ['title', 'is_food_task', 'is_reading_task', 'is_gym_task', 'is_shopping_task', 'date']
    : ['title', 'is_food_task', 'is_reading_task', 'is_gym_task', 'is_shopping_task'];
  const setClause = updates.map(c => `${c} = ?`).join(', ');
  const values = date !== null ? [title, is_food_task, is_reading_task, is_gym_task, is_shopping_task, date, id, userId] : [title, is_food_task, is_reading_task, is_gym_task, is_shopping_task, id, userId];
  db.run(`UPDATE tasks SET ${setClause} WHERE id = ? AND user_id = ?`, values, function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.sendStatus(204);
  });
});

app.delete('/tasks/:id', authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user.id;
  db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', [id, userId], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.sendStatus(204);
  });
});

// ============ NUTRICIÓN (base de datos local) ============

// Parsea una línea tipo "100g pollo", "100 g pollo" o "2 huevos" -> { grams, name }
function parseLine(line) {
  if (!line || typeof line !== 'string') return { grams: 0, name: '' };
  const s = line.trim();
  // "100gpollo" o "100g pollo" (con o sin espacio entre cantidad y nombre)
  const gNoSpace = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramos?)\s*(.+)$/i);
  if (gNoSpace) return { grams: parseFloat(String(gNoSpace[1]).replace(',', '.')) || 0, name: gNoSpace[2].trim() };
  // "100 pollo" (gramos) o "2 huevos" (porciones: 65 g por huevo, 100 g resto)
  const numMatch = s.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (numMatch) {
    const num = parseFloat(String(numMatch[1]).replace(',', '.')) || 1;
    const name = numMatch[2].trim();
    const nameLower = name.toLowerCase();
    const gramsPerUnit = (nameLower === 'huevo' || nameLower === 'huevos' || nameLower === 'egg' || nameLower === 'eggs') ? 65 : 100;
    const grams = num > 50 ? num : num * gramsPerUnit;
    return { grams, name };
  }
  return { grams: 100, name: s };
}

// Alias inglés → español
const FOOD_ALIAS_ES = {
  chicken: 'pollo', eggs: 'huevo', egg: 'huevo', milk: 'leche', bread: 'pan',
  apple: 'manzana', banana: 'plátano', rice: 'arroz', pasta: 'pasta',
  beef: 'carne vaca', carne: 'carne vaca', tuna: 'atún', atun: 'atún', cheese: 'queso', tomato: 'tomate',
  lettuce: 'lechuga', salmon: 'salmon', turkey: 'pavo', oatmeal: 'avena',
  yogurt: 'yogur', 'olive oil': 'aceite oliva', oil: 'aceite oliva',
  avocado: 'palta'
};

// Fallback en memoria: siempre disponible para "1 huevo", "100g pollo", etc. (por 100 g)
const IN_MEMORY_FOODS = [
  { name: 'arroz', calories_per_100: 130, protein_per_100: 2.7, carbs_per_100: 28, fat_per_100: 0.3 },
  { name: 'pollo', calories_per_100: 165, protein_per_100: 31, carbs_per_100: 0, fat_per_100: 3.6 },
  { name: 'huevo', calories_per_100: 155, protein_per_100: 13, carbs_per_100: 1.1, fat_per_100: 11 },
  { name: 'leche', calories_per_100: 42, protein_per_100: 3.4, carbs_per_100: 5, fat_per_100: 1 },
  { name: 'pan', calories_per_100: 265, protein_per_100: 9, carbs_per_100: 49, fat_per_100: 3.2 },
  { name: 'manzana', calories_per_100: 52, protein_per_100: 0.3, carbs_per_100: 14, fat_per_100: 0.2 },
  { name: 'plátano', calories_per_100: 89, protein_per_100: 1.1, carbs_per_100: 23, fat_per_100: 0.3 },
  { name: 'pasta', calories_per_100: 131, protein_per_100: 5, carbs_per_100: 25, fat_per_100: 1.1 },
  { name: 'carne vaca', calories_per_100: 250, protein_per_100: 26, carbs_per_100: 0, fat_per_100: 15 },
  { name: 'atún', calories_per_100: 132, protein_per_100: 28, carbs_per_100: 0, fat_per_100: 1 },
  { name: 'queso', calories_per_100: 402, protein_per_100: 25, carbs_per_100: 1.3, fat_per_100: 33 },
  { name: 'aceite oliva', calories_per_100: 884, protein_per_100: 0, carbs_per_100: 0, fat_per_100: 100 },
  { name: 'tomate', calories_per_100: 18, protein_per_100: 0.9, carbs_per_100: 3.9, fat_per_100: 0.2 },
  { name: 'lechuga', calories_per_100: 15, protein_per_100: 1.4, carbs_per_100: 2.9, fat_per_100: 0.2 },
  { name: 'pavo', calories_per_100: 135, protein_per_100: 29, carbs_per_100: 0, fat_per_100: 1.5 },
  { name: 'salmon', calories_per_100: 208, protein_per_100: 20, carbs_per_100: 0, fat_per_100: 13 },
  { name: 'avena', calories_per_100: 389, protein_per_100: 17, carbs_per_100: 66, fat_per_100: 6.9 },
  { name: 'yogur', calories_per_100: 59, protein_per_100: 10, carbs_per_100: 3.6, fat_per_100: 0.4 },
  { name: 'palta', calories_per_100: 160, protein_per_100: 2, carbs_per_100: 8.5, fat_per_100: 14.7 }
];

function findInMemory(term) {
  const t = (term || '').toLowerCase().trim();
  let f = IN_MEMORY_FOODS.find(x => x.name.toLowerCase().includes(t) || t.includes(x.name.toLowerCase()));
  if (f) return f;
  const es = FOOD_ALIAS_ES[t];
  if (es) f = IN_MEMORY_FOODS.find(x => x.name.toLowerCase() === es);
  return f || null;
}

// True si la fila de la DB no tiene datos útiles (evita usar filas viejas con 0)
function rowHasNoNutrition(row) {
  if (!row) return true;
  const cal = row.calories_per_100 ?? row.calories ?? 0;
  const p = row.protein_per_100 ?? row.protein ?? 0;
  const ch = row.carbs_per_100 ?? row.carbs ?? 0;
  const f = row.fat_per_100 ?? row.fat ?? 0;
  return cal === 0 && p === 0 && ch === 0 && f === 0;
}

function getFoodByName(name) {
  return new Promise((resolve, reject) => {
    if (!name || !name.trim()) return resolve(null);
    const q = name.trim().toLowerCase();
    const trySearch = (term, cb) => {
      const pattern = '%' + term + '%';
      db.get(
        "SELECT * FROM foods WHERE LOWER(name) LIKE ? OR ? LIKE '%' || LOWER(name) || '%' LIMIT 1",
        [pattern, term],
        (err, row) => {
          if (err) return cb(err);
          cb(null, row || null);
        }
      );
    };
    trySearch(q, (err, row) => {
      if (err) return reject(err);
      if (row && !rowHasNoNutrition(row)) return resolve(row);
      if (row) {
        const mem = findInMemory(q);
        if (mem) return resolve(mem);
        return resolve(row);
      }
      const es = FOOD_ALIAS_ES[q];
      if (es) return trySearch(es, (e, r) => {
        if (e) return reject(e);
        if (r && !rowHasNoNutrition(r)) return resolve(r);
        if (r) {
          const mem = findInMemory(es);
          if (mem) return resolve(mem);
          return resolve(r);
        }
        resolve(findInMemory(es) || null);
      });
      resolve(findInMemory(q) || null);
    });
  });
}

async function calculateFromFoods(lines) {
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  for (const line of lines) {
    const { grams, name } = parseLine(line);
    if (!name) continue;
    const food = await getFoodByName(name);
    if (!food) continue;
    const k = (grams || 0) / 100;
    // Soporta columnas calories_per_100 o calories (por 100 g)
    const c = food.calories_per_100 ?? food.calories ?? 0;
    const p = food.protein_per_100 ?? food.protein ?? 0;
    const ch = food.carbs_per_100 ?? food.carbs ?? 0;
    const f = food.fat_per_100 ?? food.fat ?? 0;
    calories += c * k;
    protein += p * k;
    carbs += ch * k;
    fat += f * k;
  }
  return { calories, protein, carbs, fat };
}

app.post('/api/nutrition/parse', authenticateToken, async (req, res) => {
  const { ingredients } = req.body || {};
  const text = typeof ingredients === 'string' ? ingredients : '';
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) {
    return res.status(400).json({ error: 'Escribe al menos un alimento (uno por línea)' });
  }
  try {
    const { calories, protein, carbs, fat } = await calculateFromFoods(lines);
    res.json({
      calories: Math.round(calories),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat)
    });
  } catch (e) {
    console.error('Error nutrición local:', e);
    res.status(500).json({ error: 'Error al calcular nutrición', details: e.message });
  }
});

// Solo desarrollo: prueba parseo sin login (quitar en producción)
app.get('/api/nutrition/parse-test', async (req, res) => {
  const text = (req.query.ingredients || '').trim();
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: 'Query ?ingredients= necesaria (ej: 1 huevo)' });
  try {
    const { calories, protein, carbs, fat } = await calculateFromFoods(lines);
    res.json({ calories: Math.round(calories), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/nutrition/save', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { task_id, meal_type, foods_text, calories, protein, carbs, fat } = req.body || {};
  if (!task_id || !meal_type) {
    return res.status(400).json({ error: 'task_id y meal_type son requeridos' });
  }
  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO meal_logs (task_id, user_id, meal_type, foods_text, calories, protein, carbs, fat, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task_id, userId, meal_type, foods_text || null, calories ?? null, protein ?? null, carbs ?? null, fat ?? null, createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error', details: err.message });
      res.status(201).json({ id: this.lastID, created_at: createdAt });
    }
  );
});

// ============ LECTURA (libro / página) ============
app.get('/api/reading/progress/:taskId', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const taskId = Number(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'task_id inválido' });
  db.get(
    'SELECT book_title, current_page, total_pages, notes FROM reading_progress WHERE task_id = ? AND user_id = ?',
    [taskId, userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'DB error', details: err.message });
      if (!row) return res.json({ book_title: '', current_page: null, total_pages: null, notes: '' });
      res.json({
        book_title: row.book_title || '',
        current_page: row.current_page,
        total_pages: row.total_pages,
        notes: row.notes || ''
      });
    }
  );
});

app.post('/api/reading/save', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { task_id, book_title, current_page, total_pages, notes } = req.body || {};
  const taskId = Number(task_id);
  if (!taskId) return res.status(400).json({ error: 'task_id requerido' });
  const now = new Date().toISOString();
  const bookTitleVal = (book_title || '').trim() || null;
  const currentPageVal = current_page != null && current_page !== '' ? Number(current_page) : null;
  const totalPagesVal = total_pages != null && total_pages !== '' ? Number(total_pages) : null;
  const notesVal = (notes || '').trim() || null;
  db.run(
    `INSERT INTO reading_progress (task_id, user_id, book_title, current_page, total_pages, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id, user_id) DO UPDATE SET book_title = excluded.book_title, current_page = excluded.current_page, total_pages = excluded.total_pages, notes = excluded.notes, updated_at = excluded.updated_at`,
    [taskId, userId, bookTitleVal, currentPageVal, totalPagesVal, notesVal, now, now],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error', details: err.message });
      res.status(201).json({ created_at: now, updated_at: now });
    }
  );
});

// ============ GYM / ENTRENAMIENTO ============
app.get('/api/gym/progress/:taskId', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const taskId = Number(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'task_id inválido' });
  db.get(
    'SELECT routine_text, duration_min, series, seconds_per_set, rest_seconds, completed_at FROM gym_progress WHERE task_id = ? AND user_id = ?',
    [taskId, userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'DB error', details: err.message });
      if (!row) return res.json({ routine_text: '', duration_min: null, series: null, seconds_per_set: null, rest_seconds: null, completed_at: null });
      res.json({
        routine_text: row.routine_text || '',
        duration_min: row.duration_min,
        series: row.series,
        seconds_per_set: row.seconds_per_set,
        rest_seconds: row.rest_seconds,
        completed_at: row.completed_at || null
      });
    }
  );
});

app.post('/api/gym/save', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { task_id, routine_text, duration_min, series, seconds_per_set, rest_seconds, completed_at } = req.body || {};
  const taskId = Number(task_id);
  if (!taskId) return res.status(400).json({ error: 'task_id requerido' });
  const now = new Date().toISOString();
  const seriesVal = series != null && series !== '' ? Number(series) : null;
  const secondsPerSetVal = seconds_per_set != null && seconds_per_set !== '' ? Number(seconds_per_set) : null;
  const restSecondsVal = rest_seconds != null && rest_seconds !== '' ? Number(rest_seconds) : null;
  const completedAtVal = (completed_at && typeof completed_at === 'string') ? completed_at : null;
  db.run(
    `INSERT INTO gym_progress (task_id, user_id, routine_text, duration_min, series, seconds_per_set, rest_seconds, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id, user_id) DO UPDATE SET
       routine_text = excluded.routine_text, duration_min = excluded.duration_min,
       series = excluded.series, seconds_per_set = excluded.seconds_per_set, rest_seconds = excluded.rest_seconds,
       completed_at = COALESCE(excluded.completed_at, completed_at),
       updated_at = excluded.updated_at`,
    [taskId, userId, (routine_text || '').trim() || null, duration_min != null && duration_min !== '' ? Number(duration_min) : null, seriesVal, secondsPerSetVal, restSecondsVal, completedAtVal, now, now],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error', details: err.message });
      res.status(201).json({ created_at: now, updated_at: now });
    }
  );
});

// ============ LISTA DE COMPRAS ============
app.get('/api/shopping/:taskId', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const taskId = Number(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'task_id inválido' });
  db.all(
    'SELECT id, item_text, sort_order, created_at FROM shopping_list_items WHERE task_id = ? AND user_id = ? ORDER BY sort_order ASC, created_at ASC',
    [taskId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error', details: err.message });
      res.json({ items: (rows || []).map(r => ({ id: r.id, item_text: r.item_text, sort_order: r.sort_order, created_at: r.created_at })) });
    }
  );
});

app.post('/api/shopping/add', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { task_id, item_text } = req.body || {};
  const taskId = Number(task_id);
  const text = (item_text != null && typeof item_text === 'string') ? item_text.trim() : '';
  if (!taskId || !text) return res.status(400).json({ error: 'task_id y item_text son requeridos' });
  const createdAt = new Date().toISOString();
  db.get('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM shopping_list_items WHERE task_id = ? AND user_id = ?', [taskId, userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error', details: err.message });
    const sortOrder = (row && row.next_order != null) ? row.next_order : 0;
    db.run(
      'INSERT INTO shopping_list_items (task_id, user_id, item_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
      [taskId, userId, text, sortOrder, createdAt],
      function (runErr) {
        if (runErr) return res.status(500).json({ error: 'DB error', details: runErr.message });
        res.status(201).json({ id: this.lastID, item_text: text, sort_order: sortOrder, created_at: createdAt });
      }
    );
  });
});

app.delete('/api/shopping/item/:id', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  db.run('DELETE FROM shopping_list_items WHERE id = ? AND user_id = ?', [id, userId], function (err) {
    if (err) return res.status(500).json({ error: 'DB error', details: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.status(204).send();
  });
});

function startHttpServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

