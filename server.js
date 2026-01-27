const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

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
      FOREIGN KEY (user_id) REFERENCES usuarios(id)
    )
  `);
  
  // Migración: agregar columna user_id si la tabla ya existe sin ella
  db.all("PRAGMA table_info(tasks)", (err, columns) => {
    if (err) {
      console.error('Error checking table structure:', err);
      return;
    }
    
    const hasUserId = columns.some(col => col.name === 'user_id');
    
    if (!hasUserId) {
      console.log('Migrating: Adding user_id column to tasks table...');
      // Primero agregar la columna (puede ser NULL temporalmente)
      db.run(`ALTER TABLE tasks ADD COLUMN user_id INTEGER`, (err) => {
        if (err) {
          console.error('Migration error:', err.message);
        } else {
          console.log('Migration: user_id column added');
          // Eliminar tareas sin usuario (no podemos asignarlas a nadie)
          db.run(`DELETE FROM tasks WHERE user_id IS NULL`, (err) => {
            if (err) {
              console.error('Error cleaning orphaned tasks:', err);
            } else {
              console.log('Migration: Cleaned up tasks without user_id');
            }
          });
        }
      });
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
  db.all('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC', [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

app.post('/tasks', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const title = (req.body.title || '').trim();
  const start_time = req.body.start_time || null;
  const end_time = req.body.end_time || null;
  if (!title) return res.status(400).json({ error: 'title required' });
  const createdAt = new Date().toISOString();
  db.run(
    'INSERT INTO tasks (user_id, title, completed, created_at, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, title, 0, createdAt, start_time, end_time],
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
  db.run('UPDATE tasks SET title = ? WHERE id = ? AND user_id = ?', [title, id, userId], function (err) {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

