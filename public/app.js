const API_URL = "/tasks";

// --- AUTH ---
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

// Si no hay token, redirigir al login
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

// Mostrar nombre de usuario si existe el elemento
window.addEventListener('DOMContentLoaded', () => {
  const userNameEl = document.getElementById('userName');
  if (userNameEl && user) {
    userNameEl.textContent = user.nombre;
  }
  
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
});

// --- DOM ---
const input = document.getElementById("taskInput");
const startInput = document.getElementById("startTime");
const endInput = document.getElementById("endTime");
const addBtn = document.getElementById("addBtn");
const list = document.getElementById("taskList");

const counter = document.getElementById("counter");
const emptyState = document.getElementById("emptyState");

const filterAll = document.getElementById("filterAll");
const filterPending = document.getElementById("filterPending");
const filterDone = document.getElementById("filterDone");
const clearDoneBtn = document.getElementById("clearDoneBtn");

// --- State ---
let tasks = [];
let currentFilter = "all"; // all | pending | done

// --- Init ---
wireEvents();
refresh();

function wireEvents() {
  addBtn.addEventListener("click", onAdd);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onAdd();
  });

  filterAll?.addEventListener("click", () => setFilter("all"));
  filterPending?.addEventListener("click", () => setFilter("pending"));
  filterDone?.addEventListener("click", () => setFilter("done"));

  clearDoneBtn?.addEventListener("click", clearCompleted);
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

async function refresh() {
  try {
    tasks = await apiGetTasks();
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

  if (counter) {
    counter.textContent = `${total} tareas • ${pending} pendientes • ${done} completadas`;
  }

  if (emptyState) {
    emptyState.classList.toggle("is-hidden", total !== 0);
  }

  // habilitar/deshabilitar limpiar completadas
  if (clearDoneBtn) {
    clearDoneBtn.disabled = done === 0;
    clearDoneBtn.style.opacity = done === 0 ? "0.55" : "1";
    clearDoneBtn.style.cursor = done === 0 ? "not-allowed" : "pointer";
  }
}

function applyFilter(all, filter) {
  if (filter === "pending") return all.filter((t) => Number(t.completed) === 0);
  if (filter === "done") return all.filter((t) => Number(t.completed) === 1);
  return all;
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

  const checkMark = document.createElement("span");
  checkMark.className = "checkmark";
  checkMark.textContent = "✓";
  check.appendChild(checkMark);

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

  const date = document.createElement("div");
  date.className = "task-date";
  const whenParts = [];
  if (task.start_time) whenParts.push(task.start_time);
  if (task.end_time) whenParts.push(task.end_time);
  const whenText = whenParts.length ? ` — ${whenParts.join(' - ')}` : '';
  date.textContent = formatDate(task.created_at) + whenText;

  textWrap.appendChild(title);
  textWrap.appendChild(date);

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
    await apiCreateTask(text, start_time, end_time);
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

async function clearCompleted() {
  const done = tasks.filter((t) => Number(t.completed) === 1);
  if (done.length === 0) return;

  // borrar una por una (simple y claro para comenzar)
  for (const t of done) {
    try {
      await apiDeleteTask(t.id);
    } catch (e) {
      console.error('Error borrando tarea', t.id, e);
    }
  }
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

async function apiCreateTask(title, start_time = null, end_time = null) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ title, start_time, end_time }),
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

async function apiParseNutrition(ingredients) {
  const base = API_URL.replace(/\/tasks$/, '');
  const res = await fetch(`${base}/api/nutrition/parse`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ ingredients })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.details || 'Error al calcular nutrición');
  }
  return res.json();
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

// --- Modales calorías ---
let currentNutritionTask = null;
let currentMealType = null;

const modalMealType = document.getElementById('modalMealType');
const modalNutrition = document.getElementById('modalNutrition');
const nutritionIngredients = document.getElementById('nutritionIngredients');
const nutritionResult = document.getElementById('nutritionResult');
const nutritionCalcBtn = document.getElementById('nutritionCalcBtn');

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

function openModalNutrition(task, mealType) {
  currentNutritionTask = task;
  currentMealType = mealType;
  if (nutritionIngredients) nutritionIngredients.value = '';
  if (nutritionResult) {
    nutritionResult.classList.add('is-hidden');
    nutritionResult.innerHTML = '';
  }
  if (modalNutrition) {
    modalNutrition.classList.remove('is-hidden');
    modalNutrition.setAttribute('aria-hidden', 'false');
  }
}

function closeModalNutrition() {
  if (modalNutrition) {
    modalNutrition.classList.add('is-hidden');
    modalNutrition.setAttribute('aria-hidden', 'true');
  }
  currentNutritionTask = null;
  currentMealType = null;
}

if (modalMealType) {
  modalMealType.querySelectorAll('.modal-meal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const meal = btn.getAttribute('data-meal');
      if (meal && currentNutritionTask) {
        closeModalMealType();
        openModalNutrition(currentNutritionTask, meal);
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
      nutritionResult.innerHTML = `
        <strong>Calorías:</strong> ${data.calories ?? 0} kcal &nbsp;
        <strong>Proteína:</strong> ${data.protein ?? 0} g &nbsp;
        <strong>Carbos:</strong> ${data.carbs ?? 0} g &nbsp;
        <strong>Grasas:</strong> ${data.fat ?? 0} g
        ${currentNutritionTask && currentMealType ? `<br><button type="button" class="btn btn-ghost" id="nutritionSaveBtn" style="margin-top:8px;">Guardar en esta tarea</button>` : ''}
      `;
      nutritionResult.classList.remove('is-hidden');
      const saveBtn = document.getElementById('nutritionSaveBtn');
      if (saveBtn && currentNutritionTask && currentMealType) {
        saveBtn.addEventListener('click', async () => {
          try {
            await apiSaveNutrition({
              task_id: currentNutritionTask.id,
              meal_type: currentMealType,
              foods_text: text,
              calories: data.calories,
              protein: data.protein,
              carbs: data.carbs,
              fat: data.fat
            });
            alert('Guardado.');
            closeModalNutrition();
          } catch (e) {
            console.error(e);
            alert('Error al guardar.');
          }
        });
      }
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error al calcular.');
    } finally {
      nutritionCalcBtn.disabled = false;
    }
  });
}

window.closeModalMealType = closeModalMealType;
window.closeModalNutrition = closeModalNutrition;

// --- Utils ---
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
