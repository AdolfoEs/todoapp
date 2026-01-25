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
  origin: ['https://sunny-babka-8a1b11.netlify.app', 'http://localhost:3000'],
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
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT
    )
  `);
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

// Registro de usuario
app.post('/register', async (req, res) => {
  const { nombre, password, correo } = req.body;
  
  if (!nombre || !password) {
    return res.status(400).json({ error: 'Nombre y contraseña son requeridos' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
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
      return res.status(500).json({ error: 'Error del servidor' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    try {
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
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

// ============ ENDPOINTS DE TAREAS ============
app.get('/tasks', (req, res) => {
  db.all('SELECT * FROM tasks ORDER BY id DESC', [], (err, rows) => {
    if (err) 
      {
       return res.status(500).json({ error: 'DB error' });
      }
      else 
      {
        res.json(rows);
      }
  });
});

app.post('/tasks', (req, res) => {
  const title = (req.body.title || '').trim();
  const start_time = req.body.start_time || null;
  const end_time = req.body.end_time || null;
  if (!title) return res.status(400).json({ error: 'title required' });
  const createdAt = new Date().toISOString();
  db.run(
    'INSERT INTO tasks (title, completed, created_at, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
    [title, 0, createdAt, start_time, end_time],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.status(201).json({
        id: this.lastID,
        title,
        completed: 0,
        created_at: createdAt,
        start_time,
        end_time,
      });
    }
  );
});

app.patch('/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const completed = req.body.completed ? 1 : 0;
  db.run('UPDATE tasks SET completed = ? WHERE id = ?', [completed, id], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.sendStatus(204);
  });
});

app.put('/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  db.run('UPDATE tasks SET title = ? WHERE id = ?', [title, id], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.sendStatus(204);
  });
});

app.delete('/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  db.run('DELETE FROM tasks WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.sendStatus(204);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

