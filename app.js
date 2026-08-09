(function initializeTelegramMiniApp() {
  const tg = window.Telegram?.WebApp;
  const form = document.querySelector("#lead-form");
  const views = document.querySelectorAll("[data-view]");
  const summary = document.querySelector("#lead-summary");
  const state = { lead: null };

  if (tg) {
    tg.ready();
    tg.expand();
  }

  const telegramUser = tg?.initDataUnsafe?.user || {};
  const nameInput = form.elements.name;

  if (telegramUser.first_name && !nameInput.value) {
    nameInput.value = telegramUser.first_name;
  }

  function showView(name) {
    views.forEach((view) => {
      const isActive = view.dataset.view === name;
      view.hidden = !isActive;
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function setFieldError(fieldName, message) {
    const field = form.elements[fieldName];
    const error = document.querySelector(`#${field.id}-error`);
    const container = field.closest(".field");
    container.classList.toggle("field-invalid", Boolean(message));
    error.textContent = message;
  }

  function validateForm() {
    const values = Object.fromEntries(new FormData(form).entries());
    const phoneDigits = values.phone.replace(/\D/g, "");
    const errors = {
      name: values.name.trim() ? "" : "Укажите имя.",
      phone: !values.phone.trim()
        ? "Укажите телефон."
        : phoneDigits.length < 7 || phoneDigits.length > 20
          ? "Проверьте длину номера."
          : "",
      interest: values.interest ? "" : "Выберите, что вас интересует.",
      preferredContact: values.preferredContact ? "" : "Выберите удобный способ связи."
    };

    Object.entries(errors).forEach(([fieldName, message]) => setFieldError(fieldName, message));
    return { values, isValid: !Object.values(errors).some(Boolean) };
  }

  function createLead(values) {
    return {
      createdAt: new Date().toISOString(),
      source: "telegram-mini-app",
      telegram: {
        id: telegramUser.id ?? null,
        username: telegramUser.username || "",
        firstName: telegramUser.first_name || "",
        lastName: telegramUser.last_name || ""
      },
      customer: {
        name: values.name.trim(),
        phone: values.phone.trim(),
        company: values.company.trim(),
        city: values.city.trim(),
        interest: values.interest,
        quantity: values.quantity.trim(),
        comment: values.comment.trim(),
        preferredContact: values.preferredContact
      }
    };
  }

  function renderSummary(lead) {
    const rows = [
      ["Имя", lead.customer.name],
      ["Телефон", lead.customer.phone],
      ["Что интересует", lead.customer.interest],
      ["Удобный способ связи", lead.customer.preferredContact],
      ["Компания / ИП", lead.customer.company],
      ["Город", lead.customer.city],
      ["Количество / объём", lead.customer.quantity],
      ["Комментарий", lead.customer.comment]
    ].filter(([, value]) => value);

    summary.replaceChildren();
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "summary-row";
      const term = document.createElement("dt");
      const definition = document.createElement("dd");
      term.textContent = label;
      definition.textContent = value;
      row.append(term, definition);
      summary.append(row);
    });
  }

  document.querySelector("#start-button").addEventListener("click", () => showView("form"));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const { values, isValid } = validateForm();

    if (!isValid) {
      form.querySelector(".field-invalid input, .field-invalid select")?.focus();
      return;
    }

    state.lead = createLead(values);
    renderSummary(state.lead);
    showView("review");
  });

  form.addEventListener("input", (event) => {
    if (["name", "phone"].includes(event.target.name)) {
      setFieldError(event.target.name, "");
    }
  });

  form.addEventListener("change", (event) => {
    if (["interest", "preferredContact"].includes(event.target.name)) {
      setFieldError(event.target.name, "");
    }
  });

  document.querySelector("#edit-button").addEventListener("click", () => showView("form"));
  document.querySelector("#send-button").addEventListener("click", () => showView("success"));
  document.querySelector("#close-button").addEventListener("click", () => {
    if (tg?.close) {
      tg.close();
    } else {
      showView("start");
    }
  });
})();
