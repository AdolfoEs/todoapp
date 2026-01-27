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

// Palabras que marcan una tarea como "de comida" (botón calorías)
const FOOD_KEYWORDS = ['almuerzo', 'cena', 'comer', 'comida', 'desayuno', 'media mañana', 'once'];
function isFoodTask(title) {
  if (!title || typeof title !== 'string') return 0;
  const t = title.toLowerCase().trim();
  return FOOD_KEYWORDS.some(kw => t.includes(kw)) ? 1 : 0;
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
    // Backfill: actualizar is_food_task en tareas existentes según el título (por si se crearon antes de la migración)
    db.all('SELECT id, title, is_food_task FROM tasks', [], (errBackfill, rows) => {
      if (errBackfill || !rows || !rows.length) return;
      const toUpdate = rows.filter((r) => {
        const want = isFoodTask(r.title) ? 1 : 0;
        const cur = r.is_food_task == null ? 0 : Number(r.is_food_task);
        return cur !== want;
      });
      toUpdate.forEach((r) => {
        db.run('UPDATE tasks SET is_food_task = ? WHERE id = ?', [isFoodTask(r.title) ? 1 : 0, r.id]);
      });
      if (toUpdate.length > 0) console.log('Backfill is_food_task: actualizadas', toUpdate.length, 'tareas existentes');
    });
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
  const is_food_task = isFoodTask(title) ? 1 : 0;
  db.run(
    'INSERT INTO tasks (user_id, title, completed, created_at, start_time, end_time, is_food_task) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, title, 0, createdAt, start_time, end_time, is_food_task],
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
  db.run('UPDATE tasks SET title = ?, is_food_task = ? WHERE id = ? AND user_id = ?', [title, is_food_task, id, userId], function (err) {
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

// ============ NUTRICIÓN (Spoonacular) ============
const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY || '';

app.post('/api/nutrition/parse', authenticateToken, async (req, res) => {
  if (!SPOONACULAR_API_KEY) {
    return res.status(503).json({ error: 'Servicio de nutrición no configurado. Configura SPOONACULAR_API_KEY.' });
  }
  const { ingredients } = req.body || {};
  const text = typeof ingredients === 'string' ? ingredients : '';
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) {
    return res.status(400).json({ error: 'Escribe al menos un alimento (uno por línea)' });
  }
  const norm = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);
  const pick = (arr, ...aliases) => {
    if (!Array.isArray(arr)) return 0;
    const a = aliases.map((s) => String(s).toLowerCase());
    const nameOf = (x) => (x?.name || x?.title || '').toString().toLowerCase().trim();
    const amt = (x) => norm(x?.amount ?? x?.value ?? 0);
    const found = arr.find((x) => a.includes(nameOf(x)));
    return amt(found);
  };
  let calories = 0, protein = 0, carbs = 0, fat = 0;

  try {
    // 1) Recipe Nutrition by Ingredients (lista → nutrición; respuesta = array por ingrediente con .nutrients)
    const tryNutritionByIngredients = async (url) => {
      const resp = await fetch(url);
      if (!resp.ok) {
        if (process.env.NODE_ENV !== 'production') console.log('NutritionByIngredients status', resp.status, await resp.text().then((t) => t.slice(0, 200)));
        return null;
      }
      const data = await resp.json();
      const items = Array.isArray(data) ? data : [];
      let c = 0, p = 0, cb = 0, f = 0;
      for (const item of items) {
        const n = item.nutrients || item.nutrition?.nutrients || [];
        c += pick(n, 'calories', 'energy');
        p += pick(n, 'protein');
        cb += pick(n, 'carbohydrates', 'carbohydrate', 'carbs');
        f += pick(n, 'fat', 'total fat');
      }
      if (c || p || cb || f) return { calories: c, protein: p, carbs: cb, fat: f };
      if (!Array.isArray(data) && data && typeof data === 'object')
        return { calories: norm(data.calories ?? data.energy), protein: norm(data.protein), carbs: norm(data.carbohydrates ?? data.carbs), fat: norm(data.fat) };
      if (process.env.NODE_ENV !== 'production' && (items.length > 0 || (data && typeof data === 'object')))
        console.log('NutritionByIngredients structure sample:', JSON.stringify(Array.isArray(data) ? (data[0] || {}) : data).slice(0, 400));
      return null;
    };
    const hasData = (r) => r && (r.calories + r.protein + r.carbs + r.fat > 0);
    const url1 = `https://api.spoonacular.com/recipes/recipeNutritionByIngredients?${lines.map((l) => `ingredients=${encodeURIComponent(l)}`).join('&')}&apiKey=${SPOONACULAR_API_KEY}`;
    const url2 = `https://api.spoonacular.com/recipes/recipeNutritionByIngredients?ingredients=${encodeURIComponent(lines.join(', '))}&apiKey=${SPOONACULAR_API_KEY}`;
    const result1 = await tryNutritionByIngredients(url1);
    if (hasData(result1)) {
      calories = result1.calories;
      protein = result1.protein;
      carbs = result1.carbs;
      fat = result1.fat;
    } else {
      const result2 = await tryNutritionByIngredients(url2);
      if (hasData(result2)) {
        calories = result2.calories;
        protein = result2.protein;
        carbs = result2.carbs;
        fat = result2.fat;
      }
    }

    // 2) Si sigue en 0, Parse Ingredients con includeNutrition
    if (calories === 0 && protein === 0 && carbs === 0 && fat === 0) {
      const body = new URLSearchParams({
        ingredientList: lines.join('\n'),
        servings: '1',
        includeNutrition: 'true'
      }).toString();
      const parseUrl = `https://api.spoonacular.com/recipes/parseIngredients?apiKey=${SPOONACULAR_API_KEY}`;
      const parseResp = await fetch(parseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (parseResp.ok) {
        const parseData = await parseResp.json();
        const parseItems = Array.isArray(parseData) ? parseData : (parseData?.ingredients || []);
        for (const item of parseItems) {
          const raw = item.nutrition?.nutrients ?? item.nutrients ?? item.nutrition ?? [];
          const list = Array.isArray(raw) ? raw : [];
          calories += pick(list, 'calories', 'energy');
          protein += pick(list, 'protein');
          carbs += pick(list, 'carbohydrates', 'carbohydrate', 'carbs');
          fat += pick(list, 'fat', 'total fat');
        }
      }
    }

    // 3) Si sigue en 0, Analyze Recipe (ingredientes + título → nutrición en .nutrition)
    if (calories === 0 && protein === 0 && carbs === 0 && fat === 0) {
      const analyzeUrl = `https://api.spoonacular.com/recipes/analyze?apiKey=${SPOONACULAR_API_KEY}`;
      const analyzeResp = await fetch(analyzeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Comida',
          servings: 1,
          ingredients: lines,
          instructions: ''
        })
      });
      if (analyzeResp.ok) {
        const ad = await analyzeResp.json();
        const nut = ad.nutrition || ad;
        const arr = nut.nutrients ?? nut;
        const list = Array.isArray(arr) ? arr : [];
        calories += pick(list, 'calories', 'energy');
        protein += pick(list, 'protein');
        carbs += pick(list, 'carbohydrates', 'carbohydrate', 'carbs');
        fat += pick(list, 'fat', 'total fat');
        if (calories === 0 && protein === 0 && carbs === 0 && fat === 0 && nut && typeof nut === 'object') {
          calories = norm(nut.calories ?? nut.energy);
          protein = norm(nut.protein);
          carbs = norm(nut.carbohydrates ?? nut.carbs);
          fat = norm(nut.fat);
        }
      }
    }

    res.json({ calories: Math.round(calories), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) });
  } catch (e) {
    console.error('Spoonacular error:', e);
    res.status(500).json({ error: 'Error al calcular nutrición', details: e.message });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

