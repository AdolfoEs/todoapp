const API_URL = "/tasks";

// --- AUTH ---
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

// Si no hay token, redirigir al login y no cargar la app
if (!token) {
  window.location.href = '/login.html';
}

// Función para obtener headers con autenticación
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

// Función para cerrar sesión
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}

// --- DOM (se asignan cuando el DOM está listo) ---
let input, startInput, endInput, addBtn, list, currentDateDisplay, emptyState, filterAll, filterPending, filterDone;
let dayProgressPct, dayProgressText, dayProgressCircle;

// --- State ---
let tasks = [];
let currentFilter = "all"; // all | pending | done

function init() {
  input = document.getElementById("taskInput");
  startInput = document.getElementById("startTime");
  endInput = document.getElementById("endTime");
  addBtn = document.getElementById("addBtn");
  list = document.getElementById("taskList");
  currentDateDisplay = document.getElementById("currentDateDisplay");
  emptyState = document.getElementById("emptyState");
  filterAll = document.getElementById("filterAll");
  filterPending = document.getElementById("filterPending");
  filterDone = document.getElementById("filterDone");
  dayProgressPct = document.getElementById("dayProgressPct");
  dayProgressText = document.getElementById("dayProgressText");
  dayProgressCircle = document.getElementById("dayProgressCircle");

  const userNameEl = document.getElementById('userName');
  if (userNameEl && user) userNameEl.textContent = user.nombre;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  wireEvents();
  refresh();
}

// --- Init (solo cuando hay token y el DOM está listo) ---
if (token) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

function wireEvents() {
  addBtn.addEventListener("click", onAdd);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onAdd();
  });

  filterAll?.addEventListener("click", () => setFilter("all"));
  filterPending?.addEventListener("click", () => setFilter("pending"));
  filterDone?.addEventListener("click", () => setFilter("done"));
}

function setFilter(filter) {
  currentFilter = filter;

  // marcar chip activo
  [filterAll, filterPending, filterDone].forEach((btn) => btn?.classList.remove("is-active"));
  if (filter === "all") filterAll?.classList.add("is-active");
  if (filter === "pending") filterPending?.classList.add("is-active");
  if (filter === "done") filterDone?.classList.add("is-active");

  render();
}

function getTodayDateStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function refresh() {
  const todayStr = getTodayDateStr();
  try {
    tasks = await apiGetTasksByDate(todayStr);
  } catch (e) {
    console.error(e);
    tasks = [];
    alert('Error al obtener tareas. Revisa tu conexión.');
  }
  render();
}

function render() {
  const visible = applyFilter(tasks, currentFilter);

  // lista
  list.innerHTML = "";
  visible.forEach((t) => list.appendChild(renderTaskItem(t)));

  // contador + empty
  const total = tasks.length;
  const done = tasks.filter((t) => Number(t.completed) === 1).length;
  const pending = total - done;

  if (emptyState) {
    emptyState.classList.toggle("is-hidden", total !== 0);
  }

  if (currentDateDisplay) {
    const d = new Date();
    currentDateDisplay.textContent = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  }

  // Progreso del Día: círculo y texto
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const circumference = 339.3;
  if (dayProgressPct) dayProgressPct.textContent = pct + '%';
  if (dayProgressCircle) dayProgressCircle.setAttribute('stroke-dashoffset', circumference * (1 - pct / 100));
  if (dayProgressText) dayProgressText.textContent = done + ' de ' + total + ' tareas completadas';
}

function applyFilter(all, filter) {
  if (filter === "pending") return all.filter((t) => Number(t.completed) === 0);
  if (filter === "done") return all.filter((t) => Number(t.completed) === 1);
  return all;
}

function addTaskToGoogleCalendar(task) {
  const title = (task.title || '').trim();
  if (!title) return;
  const dateStr = task.date || (task.created_at ? String(task.created_at).slice(0, 10) : null);
  const baseDate = dateStr ? dateStr.replace(/-/g, '') : null;
  if (!baseDate) return;

  let datesParam;
  if (task.start_time && task.end_time) {
    const start = (task.start_time.length === 5 ? task.start_time + ':00' : task.start_time).slice(0, 8).replace(/:/g, '');
    const end = (task.end_time.length === 5 ? task.end_time + ':00' : task.end_time).slice(0, 8).replace(/:/g, '');
    datesParam = baseDate + 'T' + start + '/' + baseDate + 'T' + end;
  } else if (task.start_time) {
    const start = (task.start_time.length === 5 ? task.start_time + ':00' : task.start_time).slice(0, 8).replace(/:/g, '');
    const endHour = parseInt(task.start_time.slice(0, 2), 10) + 1;
    const endMin = task.start_time.length >= 5 ? task.start_time.slice(3, 5) : '00';
    const endStr = String(endHour).padStart(2, '0') + endMin + '00';
    datesParam = baseDate + 'T' + start + '/' + baseDate + 'T' + endStr;
  } else {
    datesParam = baseDate + '/' + baseDate;
  }

  const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' +
    encodeURIComponent(title) + '&dates=' + datesParam;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function renderTaskItem(task) {
  const li = document.createElement("li");
  li.className = "item";

  const isDone = Number(task.completed) === 1;

  // checkbox
  const check = document.createElement("button");
  check.className = "check";
  check.type = "button";
  check.setAttribute("data-checked", String(isDone));
  check.setAttribute("aria-label", isDone ? "Marcar como pendiente" : "Marcar como completada");

  check.addEventListener("click", async () => {
    try {
      await apiSetCompleted(task.id, !isDone);
    } catch (e) {
      console.error(e);
      alert('Error al actualizar tarea');
      return;
    }
    await refresh();
  });

  // texto
  const textWrap = document.createElement("div");
  textWrap.className = "text";

  const title = document.createElement("div");
  title.className = "task-title" + (isDone ? " is-done" : "");
  title.textContent = task.title;

  // doble click para editar
  title.title = "Doble click para editar";
  title.addEventListener("dblclick", () => startEditTitle(li, task));

  textWrap.appendChild(title);

  if (task.start_time || task.end_time) {
    const timeParts = [];
    if (task.start_time) timeParts.push(task.start_time);
    if (task.end_time) timeParts.push(task.end_time);
    const timeEl = document.createElement("div");
    timeEl.className = "task-date";
    timeEl.textContent = timeParts.join(' – ');
    textWrap.appendChild(timeEl);
  }

  if ((task.is_food_task === 1 || task.is_food_task === true) && task.last_meal_type) {
    const mealLabels = { desayuno: 'Desayuno', media_manana: 'Media Mañana', almuerzo: 'Almuerzo', cena: 'Cena' };
    const meal = mealLabels[task.last_meal_type] || task.last_meal_type;
    const cal = task.last_calories != null ? Math.round(Number(task.last_calories)) : 0;
    const p = task.last_protein != null ? Math.round(Number(task.last_protein)) : 0;
    const c = task.last_carbs != null ? Math.round(Number(task.last_carbs)) : 0;
    const f = task.last_fat != null ? Math.round(Number(task.last_fat)) : 0;
    const nut = document.createElement('div');
    nut.className = 'task-nutrition';
    const mealSpan = document.createElement('span');
    mealSpan.className = 'task-nutrition-meal';
    mealSpan.textContent = meal;
    nut.appendChild(mealSpan);
    const macrosSpan = document.createElement('span');
    macrosSpan.className = 'task-nutrition-macros';
    macrosSpan.textContent = ` · Calorías: ${cal} · Proteínas: ${p} · Carbohidratos: ${c} · Grasas: ${f}`;
    nut.appendChild(macrosSpan);
    textWrap.appendChild(nut);
  }

  if ((task.is_reading_task === 1 || task.is_reading_task === true) && (task.book_title || task.current_page != null && task.current_page !== '')) {
    const reading = document.createElement('div');
    reading.className = 'task-reading';
    const parts = [];
    if (task.book_title) parts.push(task.book_title);
    if (task.current_page != null && task.current_page !== '') parts.push(`Pág. ${task.current_page}`);
    reading.textContent = '📖 ' + parts.join(' · ');
    textWrap.appendChild(reading);
  }

  if ((task.is_gym_task === 1 || task.is_gym_task === true) && (task.gym_routine || (task.gym_duration_min != null && task.gym_duration_min !== ''))) {
    const gym = document.createElement('div');
    gym.className = 'task-gym';
    const parts = [];
    if (task.gym_routine) parts.push(task.gym_routine);
    if (task.gym_duration_min != null && task.gym_duration_min !== '') parts.push(`${task.gym_duration_min} min`);
    gym.textContent = '💪 ' + parts.join(' · ');
    textWrap.appendChild(gym);
  }

  if ((task.is_shopping_task === 1 || task.is_shopping_task === true) && (task.shopping_count != null && Number(task.shopping_count) > 0)) {
    const shop = document.createElement('div');
    shop.className = 'task-shopping';
    shop.textContent = `🛒 ${task.shopping_count} artículo${Number(task.shopping_count) !== 1 ? 's' : ''}`;
    textWrap.appendChild(shop);
  }

  // acciones
  const actions = document.createElement("div");
  actions.className = "actions";

  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn danger";
  delBtn.type = "button";
  delBtn.textContent = "🗑";
  delBtn.title = "Eliminar";

  delBtn.addEventListener("click", async () => {
    if (!confirm('¿Eliminar esta tarea?')) return;
    try {
      await apiDeleteTask(task.id);
    } catch (e) {
      console.error(e);
      alert('Error al eliminar tarea');
      return;
    }
    await refresh();
  });

  if (task.is_food_task === 1 || task.is_food_task === true) {
    const calBtn = document.createElement("button");
    calBtn.className = "btn-calorias";
    calBtn.type = "button";
    calBtn.innerHTML = "🔥 Calorías";
    calBtn.title = "Ver calorías y macros";
    calBtn.addEventListener("click", () => openModalMealType(task));
    actions.appendChild(calBtn);
  }

  if (task.is_reading_task === 1 || task.is_reading_task === true) {
    const libroBtn = document.createElement("button");
    libroBtn.className = "btn-libro";
    libroBtn.type = "button";
    libroBtn.innerHTML = "📖 Libro";
    libroBtn.title = "Lectura";
    libroBtn.addEventListener("click", () => openModalLectura(task));
    actions.appendChild(libroBtn);
  }

  if (task.is_gym_task === 1 || task.is_gym_task === true) {
    const gymBtn = document.createElement("button");
    gymBtn.className = "btn-gym";
    gymBtn.type = "button";
    gymBtn.innerHTML = "💪 Entrenamiento";
    gymBtn.title = "Rutina / ejercicio";
    gymBtn.addEventListener("click", () => openModalGym(task));
    actions.appendChild(gymBtn);
  }

  if (task.is_shopping_task === 1 || task.is_shopping_task === true) {
    const shopBtn = document.createElement("button");
    shopBtn.className = "btn-shopping";
    shopBtn.type = "button";
    shopBtn.innerHTML = "🛒 Lista";
    shopBtn.title = "Lista de compras";
    shopBtn.addEventListener("click", () => openModalShopping(task));
    actions.appendChild(shopBtn);
  }

  const gcalBtn = document.createElement("button");
  gcalBtn.className = "btn-gcal";
  gcalBtn.type = "button";
  gcalBtn.title = "Añadir a Google Calendar";
  gcalBtn.setAttribute("aria-label", "Añadir a Google Calendar");
  gcalBtn.innerHTML = '<svg class="btn-gcal-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2" fill="#fff" stroke="rgba(0,0,0,.1)" stroke-width=".6"/><rect x="2" y="3" width="20" height="5" rx="2" fill="#4285F4"/><rect x="2" y="19" width="5" height="2" fill="#34A853"/><rect x="17" y="19" width="5" height="2" fill="#EA4335"/><rect x="9" y="19" width="6" height="2" fill="#FBBC04"/><text x="12" y="15.5" text-anchor="middle" fill="#5f6368" font-size="7" font-family="sans-serif" font-weight="700">31</text></svg>';
  gcalBtn.addEventListener("click", () => addTaskToGoogleCalendar(task));
  actions.appendChild(gcalBtn);

  actions.appendChild(delBtn);

  li.appendChild(check);
  li.appendChild(textWrap);
  li.appendChild(actions);

  return li;
}

function startEditTitle(li, task) {
  // reemplazar el título por un input
  const textWrap = li.querySelector(".text");
  if (!textWrap) return;

  const titleEl = textWrap.querySelector(".task-title");
  if (!titleEl) return;

  const oldText = task.title;

  const inputEdit = document.createElement("input");
  inputEdit.className = "edit-input";
  inputEdit.value = oldText;
  inputEdit.maxLength = 200;

  // limpiar contenido y poner input
  textWrap.replaceChild(inputEdit, titleEl);
  inputEdit.focus();
  inputEdit.select();

  const finish = async (mode) => {
    const newTitle = inputEdit.value.trim();

    // cancelar -> volver
    if (mode === "cancel") {
      await refresh();
      return;
    }

    // si quedó vacío, no guardar
    if (!newTitle) {
      await refresh();
      return;
    }

    // si no cambió, no llamar API
    if (newTitle === oldText) {
      await refresh();
      return;
    }

    try {
      await apiUpdateTitle(task.id, newTitle);
    } catch (e) {
      console.error(e);
      alert('Error al editar título');
      await refresh();
      return;
    }
    await refresh();
  };

  inputEdit.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish("save");
    if (e.key === "Escape") finish("cancel");
  });

  inputEdit.addEventListener("blur", () => finish("save"));
}

async function onAdd() {
  const text = (input.value || "").trim();
  if (!text) return;

  // read optional times in HH:MM (24h) format
  const start_time = startInput?.value ? startInput.value : null;
  const end_time = endInput?.value ? endInput.value : null;

  try {
    await apiCreateTask(text, start_time, end_time, getTodayDateStr());
  } catch (e) {
    console.error(e);
    alert('Error al crear tarea');
    return;
  }

  input.value = "";
  if (startInput) startInput.value = "";
  if (endInput) endInput.value = "";
  input.focus();

  await refresh();
}

// --- API ---
async function apiGetTasks() {
  try {
    const res = await fetch(API_URL, {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Sesión expirada. Por favor inicia sesión nuevamente");
      }
      throw new Error("Error al obtener tareas");
    }
    return res.json();
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
}

async function apiGetTasksByDate(date) {
  try {
    const res = await fetch(`${API_URL}?date=${encodeURIComponent(date)}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Sesión expirada. Por favor inicia sesión nuevamente");
      }
      throw new Error("Error al obtener tareas del día");
    }
    return res.json();
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
}

async function apiCreateTask(title, start_time = null, end_time = null, date = null) {
  try {
    const body = { title, start_time, end_time };
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) body.date = date;
    const res = await fetch(API_URL, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Sesión expirada. Por favor inicia sesión nuevamente");
      }
      throw new Error("Error al crear tarea");
    }
    return res.json();
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
}

async function apiSetCompleted(id, completed) {
  try {
    const res = await fetch(`${API_URL}/${id}`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ completed }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Sesión expirada. Por favor inicia sesión nuevamente");
      }
      throw new Error("Error al actualizar estado");
    }
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
}

async function apiUpdateTitle(id, title) {
  // backend espera PUT para actualizar título
  try {
    const res = await fetch(`${API_URL}/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Sesión expirada. Por favor inicia sesión nuevamente");
      }
      throw new Error("Error al editar título");
    }
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
}

async function apiDeleteTask(id) {
  try {
    const res = await fetch(`${API_URL}/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Sesión expirada. Por favor inicia sesión nuevamente");
      }
      throw new Error("Error al eliminar tarea");
    }
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
}

// Fallback en cliente: si la API devuelve 0, calculamos con esta lista (por 100 g)
const FOODS_LOCAL = {
  huevo: { cal: 155, p: 13, c: 1.1, f: 11 },
  huevos: { cal: 155, p: 13, c: 1.1, f: 11 },
  pollo: { cal: 165, p: 31, c: 0, f: 3.6 },
  arroz: { cal: 130, p: 2.7, c: 28, f: 0.3 },
  leche: { cal: 42, p: 3.4, c: 5, f: 1 },
  pan: { cal: 265, p: 9, c: 49, f: 3.2 },
  manzana: { cal: 52, p: 0.3, c: 14, f: 0.2 },
  plátano: { cal: 89, p: 1.1, c: 23, f: 0.3 },
  pasta: { cal: 131, p: 5, c: 25, f: 1.1 },
  'carne vaca': { cal: 250, p: 26, c: 0, f: 15 },
  carne: { cal: 250, p: 26, c: 0, f: 15 },
  queso: { cal: 402, p: 25, c: 1.3, f: 33 },
  atún: { cal: 132, p: 28, c: 0, f: 1 },
  atun: { cal: 132, p: 28, c: 0, f: 1 },
  tomate: { cal: 18, p: 0.9, c: 3.9, f: 0.2 },
  lechuga: { cal: 15, p: 1.4, c: 2.9, f: 0.2 },
  pavo: { cal: 135, p: 29, c: 0, f: 1.5 },
  salmon: { cal: 208, p: 20, c: 0, f: 13 },
  avena: { cal: 389, p: 17, c: 66, f: 6.9 },
  yogur: { cal: 59, p: 10, c: 3.6, f: 0.4 },
  egg: { cal: 155, p: 13, c: 1.1, f: 11 },
  chicken: { cal: 165, p: 31, c: 0, f: 3.6 },
  eggs: { cal: 155, p: 13, c: 1.1, f: 11 },
  milk: { cal: 42, p: 3.4, c: 5, f: 1 },
  rice: { cal: 130, p: 2.7, c: 28, f: 0.3 },
  bread: { cal: 265, p: 9, c: 49, f: 3.2 },
  palta: { cal: 160, p: 2, c: 8.5, f: 14.7 },
  avocado: { cal: 160, p: 2, c: 8.5, f: 14.7 },
  nuez: { cal: 654, p: 15, c: 14, f: 65 },
  nueces: { cal: 654, p: 15, c: 14, f: 65 },
  pepino: { cal: 15, p: 0.7, c: 3.6, f: 0.1 },
  cucumber: { cal: 15, p: 0.7, c: 3.6, f: 0.1 }
};

function calcNutritionLocal(text) {
  const lines = (text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let cal = 0, p = 0, c = 0, f = 0;
  for (const line of lines) {
    let grams = 100, name = line;
    const gMatch = line.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramos?)\s*(.+)$/i);
    if (gMatch) {
      grams = parseFloat(String(gMatch[1]).replace(',', '.')) || 0;
      name = gMatch[2].trim();
    } else {
      const nMatch = line.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
      if (nMatch) {
        const num = parseFloat(String(nMatch[1]).replace(',', '.')) || 1;
        name = nMatch[2].trim();
        const nameLower = name.toLowerCase();
        const gramsPerUnit = (nameLower === 'huevo' || nameLower === 'huevos' || nameLower === 'egg' || nameLower === 'eggs') ? 65 : 100;
        grams = num > 50 ? num : num * gramsPerUnit;
      }
    }
    const key = name.toLowerCase().trim().replace(/\s+/g, ' ');
    const food = FOODS_LOCAL[key] || FOODS_LOCAL[name.split(/\s/)[0]?.toLowerCase()];
    if (!food) {
      console.log('Alimento no encontrado en lista local:', name, 'key:', key);
      continue;
    }
    const k = (grams || 0) / 100;
    cal += (food.cal || 0) * k;
    p += (food.p || 0) * k;
    c += (food.c || 0) * k;
    f += (food.f || 0) * k;
    console.log('Calculado local:', name, grams + 'g', '→', (food.cal * k).toFixed(0) + 'kcal');
  }
  const result = { calories: Math.round(cal), protein: Math.round(p), carbs: Math.round(c), fat: Math.round(f) };
  console.log('Resultado cálculo local:', result);
  return result;
}

async function apiParseNutrition(ingredients) {
  const url = (window.location.origin || '') + '/api/nutrition/parse';
  let data = null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ ingredients })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.warn('API error, usando cálculo local:', err.error || res.statusText);
      return calcNutritionLocal(ingredients);
    }
    data = await res.json();
  } catch (e) {
    console.warn('Error de red, usando cálculo local:', e.message);
    return calcNutritionLocal(ingredients);
  }
  const sum = (data.calories || 0) + (data.protein || 0) + (data.carbs || 0) + (data.fat || 0);
  if (sum === 0 && (typeof ingredients === 'string' && ingredients.trim())) {
    console.log('API devolvió 0, usando cálculo local');
    return calcNutritionLocal(ingredients);
  }
  return data;
}

async function apiSaveNutrition(payload) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/nutrition/save`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Error al guardar');
  return res.json();
}

async function apiGetNutritionLog(taskId, mealType) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/nutrition/log?task_id=${encodeURIComponent(taskId)}&meal_type=${encodeURIComponent(mealType)}`, { headers: getAuthHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Error al cargar');
  return res.json();
}

async function apiUpdateNutritionLog(logId, payload) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/nutrition/log/${logId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Error al actualizar');
  return res.json();
}

// --- Modales calorías ---
let currentNutritionTask = null;
let currentMealType = null;
let currentNutritionLogId = null;

const modalMealType = document.getElementById('modalMealType');
const modalLectura = document.getElementById('modalLectura');
const lecturaBookTitle = document.getElementById('lecturaBookTitle');
const lecturaBookSubtitle = document.getElementById('lecturaBookSubtitle');
const lecturaTotalPages = document.getElementById('lecturaTotalPages');
const lecturaCurrentPage = document.getElementById('lecturaCurrentPage');
const lecturaNotes = document.getElementById('lecturaNotes');
const lecturaProgressPct = document.getElementById('lecturaProgressPct');
const lecturaProgressBar = document.getElementById('lecturaProgressBar');
const lecturaCurrentPageDisplay = document.getElementById('lecturaCurrentPageDisplay');
const lecturaRemainingDisplay = document.getElementById('lecturaRemainingDisplay');
const lecturaSaveBtn = document.getElementById('lecturaSaveBtn');
const lecturaCancelBtn = document.getElementById('lecturaCancelBtn');
const modalGym = document.getElementById('modalGym');
const gymRoutine = document.getElementById('gymRoutine');
const gymDuration = document.getElementById('gymDuration');
const gymSeries = document.getElementById('gymSeries');
const gymSecondsPerSet = document.getElementById('gymSecondsPerSet');
const gymRestSecondsInput = document.getElementById('gymRestSeconds');
const gymTimerDisplay = document.getElementById('gymTimerDisplay');
const gymTimerStart = document.getElementById('gymTimerStart');
const gymTimerPause = document.getElementById('gymTimerPause');
const gymTimerReset = document.getElementById('gymTimerReset');
const gymSaveBtn = document.getElementById('gymSaveBtn');
const gymOpenStopwatchBtn = document.getElementById('gymOpenStopwatchBtn');
const modalStopwatch = document.getElementById('modalStopwatch');
const stopwatchDisplay = document.getElementById('stopwatchDisplay');
const stopwatchStartBtn = document.getElementById('stopwatchStartBtn');
const stopwatchPauseBtn = document.getElementById('stopwatchPauseBtn');
const stopwatchResetBtn = document.getElementById('stopwatchResetBtn');
const stopwatchCloseBtn = document.getElementById('stopwatchCloseBtn');
const modalNutrition = document.getElementById('modalNutrition');
const nutritionIngredients = document.getElementById('nutritionIngredients');
const nutritionResult = document.getElementById('nutritionResult');
const nutritionCalcBtn = document.getElementById('nutritionCalcBtn');
const nutritionSaveBtnFixed = document.getElementById('nutritionSaveBtnFixed');

let lastCalculatedNutrition = null; // { data: { calories, protein, carbs, fat }, text }

const modalShopping = document.getElementById('modalShopping');
const shoppingNotesInput = document.getElementById('shoppingNotesInput');
const shoppingSaveListBtn = document.getElementById('shoppingSaveListBtn');
const shoppingList = document.getElementById('shoppingList');
const shoppingEmpty = document.getElementById('shoppingEmpty');

let currentShoppingTask = null;

const calendarBtn = document.getElementById('calendarBtn');
const modalCalendar = document.getElementById('modalCalendar');
const calendarGrid = document.getElementById('calendarGrid');
const calendarMonthYear = document.getElementById('calendarMonthYear');
const calendarPrevMonth = document.getElementById('calendarPrevMonth');
const calendarNextMonth = document.getElementById('calendarNextMonth');
const modalDay = document.getElementById('modalDay');
const modalDayTitle = document.getElementById('modalDayTitle');
const modalDayList = document.getElementById('modalDayList');
const dayModalTaskTitle = document.getElementById('dayModalTaskTitle');
const dayModalStartTime = document.getElementById('dayModalStartTime');
const dayModalEndTime = document.getElementById('dayModalEndTime');
const dayModalAddBtn = document.getElementById('dayModalAddBtn');

let currentDayModalDate = null;
let lastRenderedDayTasks = [];

let calendarCurrentYear = new Date().getFullYear();
let calendarCurrentMonth = new Date().getMonth();
let calendarDatesWithTasks = new Set();

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

async function fetchCalendarDatesWithTasks() {
  try {
    const res = await fetch(API_URL, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const list = await res.json();
    const set = new Set();
    (list || []).forEach((t) => {
      const dateStr = t.date || (t.created_at ? String(t.created_at).slice(0, 10) : null);
      if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) set.add(dateStr);
    });
    calendarDatesWithTasks = set;
  } catch (e) { /* ignore */ }
}

async function openModalCalendar() {
  calendarCurrentYear = new Date().getFullYear();
  calendarCurrentMonth = new Date().getMonth();
  await fetchCalendarDatesWithTasks();
  renderCalendarGrid();
  if (modalCalendar) {
    modalCalendar.classList.remove('is-hidden');
    modalCalendar.setAttribute('aria-hidden', 'false');
  }
}

function closeModalCalendar() {
  if (modalCalendar) {
    modalCalendar.classList.add('is-hidden');
    modalCalendar.setAttribute('aria-hidden', 'true');
  }
}

function renderCalendarGrid() {
  if (!calendarGrid || !calendarMonthYear) return;
  const year = calendarCurrentYear;
  const month = calendarCurrentMonth;
  calendarMonthYear.textContent = `${MONTH_NAMES[month]} ${year}`;
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay();
  const daysInMonth = last.getDate();
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  let html = '<div class="calendar-weekdays"><span>Do</span><span>Lu</span><span>Ma</span><span>Mi</span><span>Ju</span><span>Vi</span><span>Sa</span></div><div class="calendar-days">';
  for (let i = 0; i < startDay; i++) html += '<span class="calendar-day calendar-day-other"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const isToday = dateStr === todayStr;
    const hasTasks = calendarDatesWithTasks.has(dateStr);
    html += `<button type="button" class="calendar-day ${isToday ? 'calendar-day-today' : ''} ${hasTasks ? 'calendar-day-has-tasks' : ''}" data-date="${dateStr}" aria-label="Ver tareas del ${d}">${d}</button>`;
  }
  html += '</div>';
  calendarGrid.innerHTML = html;

  calendarGrid.querySelectorAll('.calendar-day[data-date]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const date = btn.getAttribute('data-date');
      if (date) onCalendarDateClick(date);
    });
  });
}

function onCalendarDateClick(date) {
  closeModalCalendar();
  openDayModal(date);
  apiGetTasksByDate(date).then((dayTasks) => {
    renderDayDetail(dayTasks, date);
  }).catch((e) => {
    console.error(e);
    modalDayList.innerHTML = '<p class="day-empty">Error al cargar las tareas.</p>';
  });
}

function openDayModal(date) {
  currentDayModalDate = date;
  const d = new Date(date + 'T12:00:00');
  const dayLabel = d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
  if (modalDayTitle) modalDayTitle.textContent = 'Día ' + dayLabel;
  if (modalDayList) modalDayList.innerHTML = '<p class="day-loading">Cargando…</p>';
  if (modalDay) {
    modalDay.classList.remove('is-hidden');
    modalDay.setAttribute('aria-hidden', 'false');
  }
  if (dayModalTaskTitle) dayModalTaskTitle.value = '';
  if (dayModalStartTime) dayModalStartTime.value = '';
  if (dayModalEndTime) dayModalEndTime.value = '';
}

function closeModalDay() {
  if (modalDay) {
    modalDay.classList.add('is-hidden');
    modalDay.setAttribute('aria-hidden', 'true');
  }
  currentDayModalDate = null;
}

function renderDayDetail(dayTasks, date) {
  if (!modalDayList) return;
  if (!dayTasks || dayTasks.length === 0) {
    modalDayList.innerHTML = '<p class="day-empty">No hay tareas este día.</p>';
    lastRenderedDayTasks = [];
    return;
  }
  lastRenderedDayTasks = dayTasks;
  // Totales de macros del día (suma de todos los meal_logs)
  let totalCal = 0, totalP = 0, totalC = 0, totalF = 0;
  dayTasks.forEach((t) => {
    (t.meal_logs || []).forEach((m) => {
      totalCal += Number(m.calories) || 0;
      totalP += Number(m.protein) || 0;
      totalC += Number(m.carbs) || 0;
      totalF += Number(m.fat) || 0;
    });
  });
  const hasMeals = totalCal > 0 || totalP > 0 || totalC > 0 || totalF > 0;
  const summaryHtml = hasMeals
    ? `<div class="day-macros-summary">Total del día: Calorías: ${Math.round(totalCal)} · Proteínas: ${Math.round(totalP)} · Carbohidratos: ${Math.round(totalC)} · Grasas: ${Math.round(totalF)}</div>`
    : '';

  const mealLabels = { desayuno: 'Desayuno', media_manana: 'Media Mañana', almuerzo: 'Almuerzo', cena: 'Cena' };
  let html = summaryHtml;
  dayTasks.forEach((t) => {
    const timeParts = [];
    if (t.start_time) timeParts.push(t.start_time);
    if (t.end_time) timeParts.push(t.end_time);
    const timeStr = timeParts.length ? timeParts.join(' – ') : '';
    const done = t.completed === 1 || t.completed === true;
    html += `<div class="day-task-item ${done ? 'is-done' : ''}">`;
    html += `<div class="day-task-header"><span class="day-task-title">${escapeHtml(t.title)}</span>`;
    if (timeStr) html += `<span class="day-task-time">${timeStr}</span>`;
    html += done ? '<span class="day-task-badge">Completada</span>' : '';
    html += '<button type="button" class="icon-btn danger day-task-delete" data-task-id="' + escapeHtml(String(t.id)) + '" title="Eliminar" aria-label="Eliminar">🗑</button>';
    html += '</div>';
    if (t.is_food_task === 1 || t.is_food_task === true) {
      const meals = t.meal_logs || [];
      if (meals.length) {
        html += '<div class="day-task-detail day-task-meals">';
        meals.forEach((m) => {
          const label = mealLabels[m.meal_type] || m.meal_type || '';
          const cal = m.calories != null ? Math.round(Number(m.calories)) : 0;
          const p = m.protein != null ? Math.round(Number(m.protein)) : 0;
          const c = m.carbs != null ? Math.round(Number(m.carbs)) : 0;
          const f = m.fat != null ? Math.round(Number(m.fat)) : 0;
          html += `<div class="day-meal-row">${label}: Calorías: ${cal} · Proteínas: ${p} · Carbohidratos: ${c} · Grasas: ${f}</div>`;
        });
        html += '</div>';
      }
    }
    if ((t.is_reading_task === 1 || t.is_reading_task === true) && (t.book_title || (t.current_page != null && t.current_page !== ''))) {
      const parts = [];
      if (t.book_title) parts.push(escapeHtml(t.book_title));
      if (t.current_page != null && t.current_page !== '') parts.push('Pág. ' + t.current_page);
      html += '<div class="day-task-detail day-task-reading">📖 ' + parts.join(' · ') + '</div>';
    }
    if ((t.is_gym_task === 1 || t.is_gym_task === true) && (t.gym_routine || (t.gym_duration_min != null && t.gym_duration_min !== '') || t.gym_series != null || t.gym_seconds_per_set != null || t.gym_rest_seconds != null)) {
      const parts = [];
      if (t.gym_routine) parts.push(escapeHtml(t.gym_routine));
      if (t.gym_duration_min != null && t.gym_duration_min !== '') parts.push(t.gym_duration_min + ' min');
      if (t.gym_series != null && t.gym_seconds_per_set != null) parts.push(t.gym_series + ' series × ' + t.gym_seconds_per_set + ' s');
      if (t.gym_rest_seconds != null) parts.push('descanso ' + t.gym_rest_seconds + ' s');
      if (parts.length) html += '<div class="day-task-detail day-task-gym">💪 ' + parts.join(' · ') + '</div>';
    }
    if (t.is_shopping_task === 1 || t.is_shopping_task === true) {
      html += '<div class="day-task-detail day-task-shopping-actions">';
      html += '<button type="button" class="btn btn-ghost day-task-open-shopping" data-task-id="' + escapeHtml(String(t.id)) + '" title="Abrir lista de compras">🛒 Lista / Agregar artículos</button>';
      html += '</div>';
    }
    html += '</div>';
  });
  modalDayList.innerHTML = html;
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

if (calendarBtn) calendarBtn.addEventListener('click', openModalCalendar);
if (calendarPrevMonth) calendarPrevMonth.addEventListener('click', () => {
  calendarCurrentMonth--;
  if (calendarCurrentMonth < 0) { calendarCurrentYear--; calendarCurrentMonth = 11; }
  renderCalendarGrid();
});
if (calendarNextMonth) calendarNextMonth.addEventListener('click', () => {
  calendarCurrentMonth++;
  if (calendarCurrentMonth > 11) { calendarCurrentYear++; calendarCurrentMonth = 0; }
  renderCalendarGrid();
});

window.closeModalCalendar = closeModalCalendar;
window.closeModalDay = closeModalDay;

if (dayModalAddBtn && dayModalTaskTitle) {
  dayModalAddBtn.addEventListener('click', async () => {
    const title = (dayModalTaskTitle.value || '').trim();
    if (!title || !currentDayModalDate) return;
    const start_time = dayModalStartTime?.value || null;
    const end_time = dayModalEndTime?.value || null;
    dayModalAddBtn.disabled = true;
    try {
      await apiCreateTask(title, start_time, end_time, currentDayModalDate);
      dayModalTaskTitle.value = '';
      if (dayModalStartTime) dayModalStartTime.value = '';
      if (dayModalEndTime) dayModalEndTime.value = '';
      const dayTasks = await apiGetTasksByDate(currentDayModalDate);
      renderDayDetail(dayTasks, currentDayModalDate);
      await refresh();
    } catch (e) {
      console.error(e);
      alert('Error al crear tarea.');
    } finally {
      dayModalAddBtn.disabled = false;
    }
  });
}

if (modalDayList) {
  modalDayList.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.day-task-delete');
    if (delBtn) {
      const id = delBtn.getAttribute('data-task-id');
      if (!id || !currentDayModalDate) return;
      if (!confirm('¿Eliminar esta tarea?')) return;
      try {
        await apiDeleteTask(id);
        const dayTasks = await apiGetTasksByDate(currentDayModalDate);
        renderDayDetail(dayTasks, currentDayModalDate);
        await refresh();
      } catch (err) {
        console.error(err);
        alert('Error al eliminar tarea.');
      }
      return;
    }
    const btn = e.target.closest('.day-task-open-shopping');
    if (!btn) return;
    const id = btn.getAttribute('data-task-id');
    if (!id) return;
    const task = lastRenderedDayTasks.find((t) => String(t.id) === id);
    if (task) openModalShopping(task);
  });
}

let currentReadingTask = null;
let currentGymTask = null;

async function apiGetReadingProgress(taskId) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/reading/progress/${taskId}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

async function apiSaveReading(taskId, book_title, current_page, total_pages, notes) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/reading/save`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ task_id: taskId, book_title, current_page, total_pages, notes })
  });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function updateReadingProgressDisplay() {
  const total = lecturaTotalPages && lecturaTotalPages.value.trim() !== '' ? parseInt(lecturaTotalPages.value, 10) : null;
  const current = lecturaCurrentPage && lecturaCurrentPage.value.trim() !== '' ? parseInt(lecturaCurrentPage.value, 10) : null;
  const totalNum = total != null && !isNaN(total) && total > 0 ? total : null;
  const currentNum = current != null && !isNaN(current) && current >= 0 ? current : null;
  let pct = 0;
  let remaining = null;
  if (totalNum != null && currentNum != null && totalNum > 0) {
    pct = Math.min(100, Math.round((currentNum / totalNum) * 100));
    remaining = Math.max(0, totalNum - currentNum);
  }
  if (lecturaProgressPct) lecturaProgressPct.textContent = pct + '%';
  if (lecturaProgressBar) lecturaProgressBar.style.width = pct + '%';
  if (lecturaCurrentPageDisplay) lecturaCurrentPageDisplay.textContent = currentNum != null ? String(currentNum) : '—';
  if (lecturaRemainingDisplay) lecturaRemainingDisplay.textContent = remaining != null ? String(remaining) : '—';
}

function openModalLectura(task) {
  currentReadingTask = task;
  if (lecturaBookTitle) lecturaBookTitle.value = '';
  if (lecturaTotalPages) lecturaTotalPages.value = '';
  if (lecturaCurrentPage) lecturaCurrentPage.value = '';
  if (lecturaNotes) lecturaNotes.value = '';
  if (lecturaBookSubtitle) lecturaBookSubtitle.textContent = 'libro';
  updateReadingProgressDisplay();
  if (modalLectura) {
    modalLectura.classList.remove('is-hidden');
    modalLectura.setAttribute('aria-hidden', 'false');
  }
  if (task && task.id) {
    apiGetReadingProgress(task.id).then((data) => {
      if (lecturaBookTitle) lecturaBookTitle.value = data.book_title || '';
      if (lecturaBookSubtitle) lecturaBookSubtitle.textContent = (data.book_title && data.book_title.trim()) ? data.book_title.trim() : 'libro';
      if (lecturaTotalPages) lecturaTotalPages.value = data.total_pages != null ? String(data.total_pages) : '';
      if (lecturaCurrentPage) lecturaCurrentPage.value = data.current_page != null ? String(data.current_page) : '';
      if (lecturaNotes) lecturaNotes.value = data.notes || '';
      updateReadingProgressDisplay();
    }).catch(() => {});
  }
}

function closeModalLectura() {
  if (modalLectura) {
    modalLectura.classList.add('is-hidden');
    modalLectura.setAttribute('aria-hidden', 'true');
  }
  currentReadingTask = null;
}

async function apiGetGymProgress(taskId) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/gym/progress/${taskId}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

const GYM_SOUNDS = {
  countdown: '/sounds/beep-countdown.mp3.mp3',
  seriesStart: '/sounds/beep-series-start.mp3.mp3',
  seriesEnd: '/sounds/beep-series-end.mp3.mp3'
};

let gymAudioContext = null;
let gymSoundBuffers = {};

async function initGymSounds() {
  if (gymSoundBuffers.countdown) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!gymAudioContext) gymAudioContext = new Ctx();
    if (gymAudioContext.state === 'suspended') await gymAudioContext.resume();
    for (const key of Object.keys(GYM_SOUNDS)) {
      const res = await fetch(GYM_SOUNDS[key]);
      if (!res.ok) continue;
      const arr = await res.arrayBuffer();
      const buf = await gymAudioContext.decodeAudioData(arr);
      gymSoundBuffers[key] = buf;
    }
  } catch (e) { /* ignore */ }
}

function playGymSound(soundKey) {
  try {
    const buf = gymSoundBuffers[soundKey];
    if (gymAudioContext && buf) {
      const src = gymAudioContext.createBufferSource();
      src.buffer = buf;
      const gain = gymAudioContext.createGain();
      gain.gain.value = 0.7;
      src.connect(gain);
      gain.connect(gymAudioContext.destination);
      src.start(0);
      return;
    }
    const audio = new Audio(GYM_SOUNDS[soundKey]);
    audio.volume = 0.7;
    audio.play().catch(() => {});
  } catch (e) { /* ignore */ }
}

function playGymBeep() {
  playGymSound('countdown');
}

function playGymWhistle() {
  playGymSound('seriesStart');
}

function playGymStartSeries() {
  playGymSound('seriesStart');
}

function playGymDoubleBeep() {
  playGymSound('seriesEnd');
  setTimeout(() => playGymSound('seriesEnd'), 180);
}

let gymTimerIntervalId = null;
let gymTimerState = 'idle';
let gymTimerCurrentSet = 1;
let gymTimerRemaining = 0;
let gymTimerTotalSets = 1;
let gymTimerSecondsPerSet = 20;
let gymTimerRestSeconds = 30;
let gymTimerPausedRemaining = 0;
let gymTimerPausedState = null;

function updateGymTimerDisplay(options) {
  if (!gymTimerDisplay) return;
  const pulse = options && options.pulse;
  gymTimerDisplay.classList.remove('gym-timer-display--work', 'gym-timer-display--rest', 'gym-timer-display--prep');
  if (gymTimerState === 'idle' || gymTimerState === 'paused') {
    if (gymTimerState === 'paused' && gymTimerPausedRemaining !== null) {
      if (gymTimerPausedState === 'prep') {
        gymTimerDisplay.classList.add('gym-timer-display--prep');
        gymTimerDisplay.textContent = `Prepárate · ${gymTimerPausedRemaining}`;
      } else {
        const phase = gymTimerPausedRemaining > 0 ? 'work' : 'rest';
        gymTimerDisplay.classList.add(phase === 'work' ? 'gym-timer-display--work' : 'gym-timer-display--rest');
        const rem = phase === 'work' ? gymTimerPausedRemaining : -gymTimerPausedRemaining;
        gymTimerDisplay.textContent = phase === 'work'
          ? `Serie ${gymTimerCurrentSet}/${gymTimerTotalSets} · ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`
          : `Descanso · ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
      }
    }
    if (pulse) {
      gymTimerDisplay.classList.add('gym-timer-pulse');
      setTimeout(() => gymTimerDisplay.classList.remove('gym-timer-pulse'), 250);
    }
    return;
  }
  if (gymTimerState === 'prep') {
    gymTimerDisplay.classList.add('gym-timer-display--prep');
    gymTimerDisplay.textContent = `Prepárate · ${gymTimerRemaining}`;
  } else {
    if (gymTimerState === 'work') gymTimerDisplay.classList.add('gym-timer-display--work');
    else if (gymTimerState === 'rest') gymTimerDisplay.classList.add('gym-timer-display--rest');
    const m = Math.floor(Math.abs(gymTimerRemaining) / 60);
    const s = Math.abs(gymTimerRemaining) % 60;
    const timeStr = `${m}:${String(s).padStart(2, '0')}`;
    if (gymTimerState === 'work') {
      gymTimerDisplay.textContent = `Serie ${gymTimerCurrentSet}/${gymTimerTotalSets} · ${timeStr}`;
    } else {
      gymTimerDisplay.textContent = `Descanso · ${timeStr}`;
    }
  }
  if (pulse) {
    gymTimerDisplay.classList.add('gym-timer-pulse');
    setTimeout(() => gymTimerDisplay.classList.remove('gym-timer-pulse'), 250);
  }
}

function gymTimerTick() {
  if (gymTimerState === 'prep') {
    gymTimerRemaining--;
    if (gymTimerRemaining <= 0) {
      playGymStartSeries();
      gymTimerState = 'work';
      gymTimerRemaining = gymTimerSecondsPerSet;
    }
    updateGymTimerDisplay({ pulse: true });
    return;
  }
  if (gymTimerState === 'work') {
    if (gymTimerRemaining <= 5 && gymTimerRemaining > 0) playGymBeep();
    gymTimerRemaining--;
    if (gymTimerRemaining <= 0) {
      playGymDoubleBeep();
      if (gymTimerCurrentSet >= gymTimerTotalSets) {
        gymTimerStop();
        if (currentGymTask && currentGymTask.id) {
          apiSaveGym(currentGymTask.id, gymRoutine?.value?.trim() || '', gymDuration?.value ? parseInt(gymDuration.value, 10) : null, gymTimerTotalSets, gymTimerSecondsPerSet, gymTimerRestSeconds, new Date().toISOString()).catch(() => {});
        }
        return;
      }
      gymTimerState = 'rest';
      gymTimerRemaining = gymTimerRestSeconds;
    }
  } else if (gymTimerState === 'rest') {
    gymTimerRemaining--;
    if (gymTimerRemaining <= 0) {
      playGymStartSeries();
      gymTimerCurrentSet++;
      gymTimerState = 'work';
      gymTimerRemaining = gymTimerSecondsPerSet;
    }
  }
  updateGymTimerDisplay({ pulse: true });
}

function gymTimerStop() {
  if (gymTimerIntervalId) {
    clearInterval(gymTimerIntervalId);
    gymTimerIntervalId = null;
  }
  gymTimerState = 'idle';
  if (gymTimerDisplay) {
    gymTimerDisplay.classList.remove('gym-timer-display--work', 'gym-timer-display--rest', 'gym-timer-display--prep', 'gym-timer-pulse');
    gymTimerDisplay.classList.add('is-hidden');
  }
  if (gymTimerStart) gymTimerStart.classList.remove('is-hidden');
  if (gymTimerPause) {
    gymTimerPause.classList.add('is-hidden');
    gymTimerPause.textContent = 'Pausar';
  }
}

function gymTimerPauseToggle() {
  if (gymTimerState === 'work' || gymTimerState === 'rest' || gymTimerState === 'prep') {
    gymTimerPausedState = gymTimerState;
    gymTimerState = 'paused';
    gymTimerPausedRemaining = gymTimerPausedState === 'rest' ? -gymTimerRemaining : gymTimerRemaining;
    if (gymTimerIntervalId) {
      clearInterval(gymTimerIntervalId);
      gymTimerIntervalId = null;
    }
    if (gymTimerPause) gymTimerPause.textContent = 'Reanudar';
    updateGymTimerDisplay();
  } else if (gymTimerState === 'paused') {
    gymTimerState = gymTimerPausedState;
    gymTimerRemaining = gymTimerPausedState === 'rest' ? -gymTimerPausedRemaining : gymTimerPausedRemaining;
    if (gymTimerPause) gymTimerPause.textContent = 'Pausar';
    updateGymTimerDisplay({ pulse: true });
    gymTimerIntervalId = setInterval(gymTimerTick, 1000);
  }
}

async function apiSaveGym(taskId, routine_text, duration_min, series, seconds_per_set, rest_seconds, completed_at) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/gym/save`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ task_id: taskId, routine_text, duration_min, series, seconds_per_set, rest_seconds, completed_at })
  });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function openModalGym(task) {
  currentGymTask = task;
  gymTimerStop();
  if (gymRoutine) gymRoutine.value = '';
  if (gymDuration) gymDuration.value = '';
  if (gymSeries) gymSeries.value = '';
  if (gymSecondsPerSet) gymSecondsPerSet.value = '';
  if (gymRestSecondsInput) gymRestSecondsInput.value = '';
  if (modalGym) {
    modalGym.classList.remove('is-hidden');
    modalGym.setAttribute('aria-hidden', 'false');
  }
  if (task && task.id) {
    apiGetGymProgress(task.id).then((data) => {
      if (gymRoutine) gymRoutine.value = data.routine_text || '';
      if (gymDuration) gymDuration.value = data.duration_min != null ? String(data.duration_min) : '';
      if (gymSeries) gymSeries.value = data.series != null ? String(data.series) : '';
      if (gymSecondsPerSet) gymSecondsPerSet.value = data.seconds_per_set != null ? String(data.seconds_per_set) : '';
      if (gymRestSecondsInput) gymRestSecondsInput.value = data.rest_seconds != null ? String(data.rest_seconds) : '';
    }).catch(() => {});
  }
}

function closeModalGym() {
  gymTimerStop();
  if (modalGym) {
    modalGym.classList.add('is-hidden');
    modalGym.setAttribute('aria-hidden', 'true');
  }
  currentGymTask = null;
}

// --- Cronómetro (independiente del Timer por series) ---
let stopwatchElapsedMs = 0;
let stopwatchStartTime = null;
let stopwatchIntervalId = null;

function formatStopwatch(ms) {
  const totalCs = Math.floor(ms / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hours = Math.floor(totalMin / 60);
  return `${String(hours).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function updateStopwatchDisplay() {
  if (!stopwatchDisplay) return;
  let ms = stopwatchElapsedMs;
  if (stopwatchStartTime !== null) {
    ms += (Date.now() - stopwatchStartTime);
  }
  stopwatchDisplay.textContent = formatStopwatch(ms);
}

function stopwatchTick() {
  updateStopwatchDisplay();
}

function stopwatchStart() {
  if (stopwatchStartTime !== null) return;
  stopwatchStartTime = Date.now();
  stopwatchIntervalId = setInterval(stopwatchTick, 10);
  if (stopwatchStartBtn) {
    stopwatchStartBtn.classList.add('is-hidden');
    stopwatchStartBtn.disabled = true;
  }
  if (stopwatchPauseBtn) {
    stopwatchPauseBtn.classList.remove('is-hidden');
    stopwatchPauseBtn.textContent = 'Pausar';
    stopwatchPauseBtn.disabled = false;
  }
}

function stopwatchPause() {
  if (stopwatchStartTime === null) return;
  stopwatchElapsedMs += (Date.now() - stopwatchStartTime);
  stopwatchStartTime = null;
  if (stopwatchIntervalId) {
    clearInterval(stopwatchIntervalId);
    stopwatchIntervalId = null;
  }
  updateStopwatchDisplay();
  if (stopwatchStartBtn) {
    stopwatchStartBtn.classList.remove('is-hidden');
    stopwatchStartBtn.textContent = 'Reanudar';
    stopwatchStartBtn.disabled = false;
  }
  if (stopwatchPauseBtn) {
    stopwatchPauseBtn.classList.add('is-hidden');
    stopwatchPauseBtn.disabled = true;
  }
}

function stopwatchReset() {
  if (stopwatchIntervalId) {
    clearInterval(stopwatchIntervalId);
    stopwatchIntervalId = null;
  }
  stopwatchStartTime = null;
  stopwatchElapsedMs = 0;
  updateStopwatchDisplay();
  if (stopwatchStartBtn) {
    stopwatchStartBtn.classList.remove('is-hidden');
    stopwatchStartBtn.textContent = 'Iniciar';
    stopwatchStartBtn.disabled = false;
  }
  if (stopwatchPauseBtn) {
    stopwatchPauseBtn.classList.add('is-hidden');
    stopwatchPauseBtn.textContent = 'Pausar';
    stopwatchPauseBtn.disabled = false;
  }
}

function openStopwatchModal() {
  stopwatchReset();
  if (modalStopwatch) {
    modalStopwatch.classList.remove('is-hidden');
    modalStopwatch.setAttribute('aria-hidden', 'false');
  }
}

function closeStopwatchModal() {
  stopwatchPause();
  stopwatchReset();
  if (modalStopwatch) {
    modalStopwatch.classList.add('is-hidden');
    modalStopwatch.setAttribute('aria-hidden', 'true');
  }
}

function openModalMealType(task) {
  currentNutritionTask = task;
  currentMealType = null;
  if (modalMealType) {
    modalMealType.classList.remove('is-hidden');
    modalMealType.setAttribute('aria-hidden', 'false');
  }
}

function closeModalMealType() {
  if (modalMealType) {
    modalMealType.classList.add('is-hidden');
    modalMealType.setAttribute('aria-hidden', 'true');
  }
  currentNutritionTask = null;
  currentMealType = null;
}

async function openModalNutrition(task, mealType) {
  currentNutritionTask = task;
  currentMealType = mealType;
  currentNutritionLogId = null;
  lastCalculatedNutrition = null;
  if (nutritionIngredients) nutritionIngredients.value = '';
  if (nutritionResult) {
    nutritionResult.classList.add('is-hidden');
    nutritionResult.innerHTML = '';
  }
  if (nutritionSaveBtnFixed) {
    nutritionSaveBtnFixed.style.display = '';
    nutritionSaveBtnFixed.style.visibility = 'visible';
    nutritionSaveBtnFixed.disabled = !(task && mealType);
  }
  if (modalNutrition) {
    modalNutrition.classList.remove('is-hidden');
    modalNutrition.setAttribute('aria-hidden', 'false');
  }
  if (task && task.id && mealType) {
    try {
      const log = await apiGetNutritionLog(task.id, mealType);
      if (log && (log.foods_text != null || (log.calories != null && log.calories > 0))) {
        currentNutritionLogId = log.id;
        if (nutritionIngredients) nutritionIngredients.value = log.foods_text || '';
        lastCalculatedNutrition = {
          data: { calories: log.calories ?? 0, protein: log.protein ?? 0, carbs: log.carbs ?? 0, fat: log.fat ?? 0 },
          text: log.foods_text || ''
        };
        if (nutritionResult) {
          nutritionResult.innerHTML = `
            <strong>Calorías:</strong> ${log.calories ?? 0} kcal &nbsp;
            <strong>Proteína:</strong> ${log.protein ?? 0} g &nbsp;
            <strong>Carbos:</strong> ${log.carbs ?? 0} g &nbsp;
            <strong>Grasas:</strong> ${log.fat ?? 0} g
          `;
          nutritionResult.classList.remove('is-hidden');
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

function closeModalNutrition() {
  if (modalNutrition) {
    modalNutrition.classList.add('is-hidden');
    modalNutrition.setAttribute('aria-hidden', 'true');
  }
  currentNutritionTask = null;
  currentMealType = null;
  currentNutritionLogId = null;
}

async function loadShoppingItems(taskId) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/shopping/${taskId}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Error al cargar la lista');
  const data = await res.json();
  return data.items || [];
}

function renderShoppingList(items) {
  if (!shoppingList) return;
  shoppingList.innerHTML = '';
  (items || []).forEach((item) => {
    const li = document.createElement('li');
    li.className = 'shopping-list-item';
    li.setAttribute('data-id', item.id);
    const text = document.createElement('span');
    text.className = 'shopping-list-text';
    text.textContent = item.item_text;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn danger shopping-item-del';
    delBtn.textContent = '🗑';
    delBtn.title = 'Eliminar';
    delBtn.setAttribute('aria-label', 'Eliminar artículo');
    delBtn.addEventListener('click', async () => {
      const base = API_URL.replace(/\/tasks$/, '');
      try {
        const r = await fetch(`${base}/api/shopping/item/${item.id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Error al eliminar');
        if (currentShoppingTask) {
          const list = await loadShoppingItems(currentShoppingTask.id);
          renderShoppingList(list);
          if (shoppingEmpty) shoppingEmpty.classList.toggle('is-hidden', list.length > 0);
          await refresh();
        }
      } catch (e) {
        console.error(e);
        alert('Error al eliminar.');
      }
    });
    li.appendChild(text);
    li.appendChild(delBtn);
    shoppingList.appendChild(li);
  });
  if (shoppingEmpty) shoppingEmpty.classList.toggle('is-hidden', (items || []).length > 0);
}

function openModalShopping(task) {
  currentShoppingTask = task;
  if (shoppingNotesInput) shoppingNotesInput.value = '';
  if (shoppingList) shoppingList.innerHTML = '';
  if (shoppingEmpty) shoppingEmpty.classList.remove('is-hidden');
  if (modalShopping) {
    modalShopping.classList.remove('is-hidden');
    modalShopping.setAttribute('aria-hidden', 'false');
  }
  if (task && task.id) {
    loadShoppingItems(task.id)
      .then((items) => {
        renderShoppingList(items);
        if (shoppingNotesInput && items && items.length > 0) {
          shoppingNotesInput.value = items.map((i) => i.item_text).join('\n');
        }
      })
      .catch((e) => {
        console.error(e);
        renderShoppingList([]);
      });
  }
  requestAnimationFrame(() => shoppingNotesInput?.focus());
}

function closeModalShopping() {
  if (modalShopping) {
    modalShopping.classList.add('is-hidden');
    modalShopping.setAttribute('aria-hidden', 'true');
  }
  currentShoppingTask = null;
}

if (shoppingSaveListBtn && shoppingNotesInput) {
  const saveShoppingList = async () => {
    const raw = (shoppingNotesInput.value || '').trim();
    if (!raw || !currentShoppingTask || !currentShoppingTask.id) return;
    const lines = [...new Set(raw.split('\n').map((s) => s.trim()).filter(Boolean))];
    if (lines.length === 0) return;
    const base = API_URL.replace(/\/tasks$/, '');
    shoppingSaveListBtn.disabled = true;
    try {
      const existing = await loadShoppingItems(currentShoppingTask.id);
      const existingText = new Set((existing || []).map((i) => i.item_text));
      for (const item_text of lines) {
        if (existingText.has(item_text)) continue;
        const res = await fetch(`${base}/api/shopping/add`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: currentShoppingTask.id, item_text })
        });
        if (!res.ok) throw new Error('Error al agregar');
        await res.json();
        existingText.add(item_text);
      }
      const list = await loadShoppingItems(currentShoppingTask.id);
      renderShoppingList(list);
      if (shoppingEmpty) shoppingEmpty.classList.add('is-hidden');
      await refresh();
      shoppingNotesInput.value = list.map((i) => i.item_text).join('\n');
      if (currentDayModalDate) {
        const dayTasks = await apiGetTasksByDate(currentDayModalDate);
        renderDayDetail(dayTasks, currentDayModalDate);
      }
    } catch (e) {
      console.error(e);
      alert('Error al agregar.');
    } finally {
      shoppingSaveListBtn.disabled = false;
    }
  };
  shoppingSaveListBtn.addEventListener('click', saveShoppingList);
}

if (lecturaTotalPages) lecturaTotalPages.addEventListener('input', updateReadingProgressDisplay);
if (lecturaCurrentPage) lecturaCurrentPage.addEventListener('input', updateReadingProgressDisplay);
if (lecturaBookTitle) lecturaBookTitle.addEventListener('input', () => { if (lecturaBookSubtitle) lecturaBookSubtitle.textContent = lecturaBookTitle.value.trim() || 'libro'; });

if (lecturaCancelBtn) lecturaCancelBtn.addEventListener('click', closeModalLectura);

if (lecturaSaveBtn && lecturaBookTitle && lecturaCurrentPage) {
  lecturaSaveBtn.addEventListener('click', async () => {
    if (!currentReadingTask || !currentReadingTask.id) return;
    const book_title = lecturaBookTitle.value.trim();
    const pageVal = lecturaCurrentPage.value.trim();
    const current_page = pageVal === '' ? null : parseInt(pageVal, 10);
    const totalVal = lecturaTotalPages ? lecturaTotalPages.value.trim() : '';
    const total_pages = totalVal === '' ? null : parseInt(totalVal, 10);
    const notes = lecturaNotes ? lecturaNotes.value.trim() : '';
    lecturaSaveBtn.disabled = true;
    try {
      await apiSaveReading(currentReadingTask.id, book_title, current_page, total_pages, notes);
      closeModalLectura();
      await refresh();
    } catch (e) {
      console.error(e);
      alert('Error al guardar.');
    } finally {
      lecturaSaveBtn.disabled = false;
    }
  });
}

if (gymTimerStart) {
  gymTimerStart.addEventListener('click', async () => {
    const total = gymSeries?.value ? parseInt(gymSeries.value, 10) : 0;
    const perSet = gymSecondsPerSet?.value ? parseInt(gymSecondsPerSet.value, 10) : 0;
    const rest = gymRestSecondsInput?.value !== '' && gymRestSecondsInput?.value != null ? parseInt(gymRestSecondsInput.value, 10) : 0;
    if (!total || total < 1 || !perSet || perSet < 1) {
      alert('Indica Nº de series y Segundos por serie (mín. 1).');
      return;
    }
    if (gymTimerState === 'idle') {
      await initGymSounds();
      gymTimerTotalSets = total;
      gymTimerSecondsPerSet = perSet;
      gymTimerRestSeconds = rest >= 0 ? rest : 0;
      gymTimerCurrentSet = 1;
      gymTimerState = 'prep';
      gymTimerRemaining = 5;
      if (gymTimerDisplay) gymTimerDisplay.classList.remove('is-hidden');
      if (gymTimerStart) gymTimerStart.classList.add('is-hidden');
      if (gymTimerPause) {
        gymTimerPause.classList.remove('is-hidden');
        gymTimerPause.textContent = 'Pausar';
      }
      updateGymTimerDisplay({ pulse: true });
      gymTimerIntervalId = setInterval(gymTimerTick, 1000);
    }
  });
}
if (gymTimerPause) gymTimerPause.addEventListener('click', gymTimerPauseToggle);
if (gymTimerReset) {
  gymTimerReset.addEventListener('click', () => {
    gymTimerStop();
  });
}

if (gymOpenStopwatchBtn) gymOpenStopwatchBtn.addEventListener('click', openStopwatchModal);
if (stopwatchCloseBtn) stopwatchCloseBtn.addEventListener('click', closeStopwatchModal);
if (stopwatchStartBtn) stopwatchStartBtn.addEventListener('click', stopwatchStart);
if (stopwatchPauseBtn) stopwatchPauseBtn.addEventListener('click', stopwatchPause);
if (stopwatchResetBtn) stopwatchResetBtn.addEventListener('click', stopwatchReset);

if (gymSaveBtn && gymRoutine && gymDuration) {
  gymSaveBtn.addEventListener('click', async () => {
    if (!currentGymTask || !currentGymTask.id) return;
    const routine_text = gymRoutine.value.trim();
    const durVal = gymDuration.value.trim();
    const duration_min = durVal === '' ? null : parseInt(durVal, 10);
    const seriesVal = gymSeries?.value ? parseInt(gymSeries.value, 10) : null;
    const secondsPerSetVal = gymSecondsPerSet?.value ? parseInt(gymSecondsPerSet.value, 10) : null;
    const restSecondsVal = gymRestSecondsInput?.value !== '' && gymRestSecondsInput?.value != null ? parseInt(gymRestSecondsInput.value, 10) : null;
    gymSaveBtn.disabled = true;
    try {
      await apiSaveGym(currentGymTask.id, routine_text, duration_min, seriesVal, secondsPerSetVal, restSecondsVal, null);
      closeModalGym();
      await refresh();
    } catch (e) {
      console.error(e);
      alert('Error al guardar.');
    } finally {
      gymSaveBtn.disabled = false;
    }
  });
}

if (modalMealType) {
  modalMealType.querySelectorAll('.modal-meal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const meal = btn.getAttribute('data-meal');
      if (meal && currentNutritionTask) {
        // IMPORTANTE: closeModalMealType() limpia currentNutritionTask.
        // Guardamos referencia antes de cerrar para no perder el task_id.
        const taskRef = currentNutritionTask;
        closeModalMealType();
        openModalNutrition(taskRef, meal);
        requestAnimationFrame(() => {
          const focusable = modalNutrition?.querySelector('.modal-close, .modal-tab, textarea, button');
          if (focusable) focusable.focus();
        });
      }
    });
  });
}

if (nutritionCalcBtn && nutritionIngredients && nutritionResult) {
  nutritionCalcBtn.addEventListener('click', async () => {
    const text = (nutritionIngredients.value || '').trim();
    if (!text) {
      alert('Escribe al menos un alimento (uno por línea).');
      return;
    }
    nutritionCalcBtn.disabled = true;
    try {
      const data = await apiParseNutrition(text);
      lastCalculatedNutrition = { data: { calories: data.calories, protein: data.protein, carbs: data.carbs, fat: data.fat }, text };
      const debug = (data._debug && !(data.calories || data.protein || data.carbs || data.fat)) ? `<br><small style="color:var(--muted);word-break:break-all;font-size:11px;">Respuesta API (para depurar): ${data._debug}</small>` : '';
      nutritionResult.innerHTML = `
        <strong>Calorías:</strong> ${data.calories ?? 0} kcal &nbsp;
        <strong>Proteína:</strong> ${data.protein ?? 0} g &nbsp;
        <strong>Carbos:</strong> ${data.carbs ?? 0} g &nbsp;
        <strong>Grasas:</strong> ${data.fat ?? 0} g
        ${debug}
      `;
      nutritionResult.classList.remove('is-hidden');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error al calcular.');
    } finally {
      nutritionCalcBtn.disabled = false;
    }
  });
}

if (nutritionSaveBtnFixed) {
  nutritionSaveBtnFixed.addEventListener('click', async () => {
    if (!currentNutritionTask || !currentMealType) {
      alert('Para guardar, abre este modal desde una tarea (pulsa "Calorías" en una tarea de comida) y elige el tipo de comida (Desayuno, Almuerzo, etc.).');
      return;
    }
    const payload = lastCalculatedNutrition
      ? {
          foods_text: (nutritionIngredients && nutritionIngredients.value.trim()) || lastCalculatedNutrition.text,
          calories: lastCalculatedNutrition.data.calories,
          protein: lastCalculatedNutrition.data.protein,
          carbs: lastCalculatedNutrition.data.carbs,
          fat: lastCalculatedNutrition.data.fat
        }
      : null;
    if (!payload) {
      alert('Pulsa "Calcular" primero para obtener los macros y luego "Guardar".');
      return;
    }
    nutritionSaveBtnFixed.disabled = true;
    try {
      if (currentNutritionLogId) {
        await apiUpdateNutritionLog(currentNutritionLogId, payload);
      } else {
        await apiSaveNutrition({
          task_id: currentNutritionTask.id,
          meal_type: currentMealType,
          ...payload
        });
      }
      closeModalNutrition();
      await refresh();
      alert('Guardado.');
    } catch (e) {
      console.error(e);
      alert('Error al guardar.');
    } finally {
      nutritionSaveBtnFixed.disabled = false;
    }
  });
}

window.closeModalMealType = closeModalMealType;
window.closeModalLectura = closeModalLectura;
window.closeModalGym = closeModalGym;
window.closeStopwatchModal = closeStopwatchModal;
window.closeModalNutrition = closeModalNutrition;
window.closeModalShopping = closeModalShopping;

// --- Utils ---
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}
