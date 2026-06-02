(function () {
  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function getGlobal(name) {
    try {
      return Function("return typeof " + name + " !== 'undefined' ? " + name + " : undefined")();
    } catch {
      return undefined;
    }
  }

  function fieldFor(element) {
    return element?.closest?.(".field") || null;
  }

  function periodLabel(value) {
    return value ? "Period " + value : "";
  }

  function periodFromClass(value) {
    const match = text(value).match(/period\s*(\d)/i);
    return match ? match[1] : "";
  }

  function slug(value) {
    return text(value)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "student";
  }

  function syntheticEmail(name, period) {
    if (!name || !period) return "";
    return slug(name + "-period-" + period) + "@lesson.local";
  }

  function updateState(name, period, email, className) {
    const state = getGlobal("state");
    if (typeof state !== "object" || !state) return;
    const info = state.studentInfo || state.student || {};
    info.name = name;
    info.email = email;
    info.period = period;
    info.className = className;
    info.classPeriod = className;
    if ("class" in info) info.class = className;
    if (state.studentInfo) state.studentInfo = info;
    if (state.student) state.student = info;
  }

  function enhanceLogin() {
    const nameEl = document.getElementById("studentName");
    if (!nameEl || nameEl.dataset.simplifiedLogin === "1") return;
    nameEl.dataset.simplifiedLogin = "1";
    installSelectStyle();

    const nameLabel = document.querySelector('label[for="studentName"]');
    if (nameLabel) {
      nameLabel.innerHTML = 'Full Name <span style="font-weight:400; font-style:italic; letter-spacing:0; text-transform:none; font-size:11px;">(e.g. Smith, John)</span>';
    }
    nameEl.placeholder = "Last name, First name";

    let emailEl = document.getElementById("studentEmail");
    let classEl = document.getElementById("studentClass");
    let periodEl = document.getElementById("studentPeriod");
    if (!periodEl) {
      periodEl = document.createElement("select");
      periodEl.id = "studentPeriod";
      periodEl.innerHTML =
        '<option value="">Select your period...</option>' +
        '<option value="1">Period 1</option>' +
        '<option value="2">Period 2</option>' +
        '<option value="3">Period 3</option>' +
        '<option value="4">Period 4</option>' +
        '<option value="5">Period 5</option>';

      const periodField = document.createElement("div");
      periodField.className = "field";
      periodField.innerHTML = '<label for="studentPeriod">Period</label>';
      periodField.appendChild(periodEl);

      const emailField = fieldFor(emailEl);
      const nameField = fieldFor(nameEl);
      const parent = emailField?.parentNode || nameField?.parentNode;
      if (parent && emailField) parent.insertBefore(periodField, emailField);
      else if (nameField) nameField.insertAdjacentElement("afterend", periodField);
    }

    if (!emailEl) {
      emailEl = document.createElement("input");
      emailEl.id = "studentEmail";
      document.body.appendChild(emailEl);
    }

    if (!classEl) {
      classEl = document.createElement("input");
      classEl.id = "studentClass";
      document.body.appendChild(classEl);
    }

    [fieldFor(emailEl), fieldFor(classEl)].forEach(field => {
      if (field) field.style.display = "none";
    });
    emailEl.type = "hidden";
    classEl.type = "hidden";
    emailEl.autocomplete = "off";
    classEl.autocomplete = "off";

    const alertEl = document.getElementById("setupAlert");
    if (alertEl) alertEl.textContent = "Please fill in your name and select your period before starting.";

    function sync() {
      const name = nameEl.value.trim();
      let period = periodEl.value || periodFromClass(classEl.value);
      if (period && !periodEl.value) periodEl.value = period;
      const className = periodLabel(period);
      const email = syntheticEmail(name, period);
      classEl.value = className;
      emailEl.value = email;
      updateState(name, period, email, className);
      return { name, period, email, className };
    }

    const originalPersist = window.persistInputsToState;
    if (typeof originalPersist === "function") {
      window.persistInputsToState = function () {
        sync();
        const result = originalPersist.apply(this, arguments);
        sync();
        return result;
      };
    }

    const originalBegin = window.beginLesson;
    if (typeof originalBegin === "function") {
      window.beginLesson = function () {
        const info = sync();
        if (!info.name || !info.period) {
          if (alertEl) {
            alertEl.textContent = "Please fill in your name and select your period before starting.";
            alertEl.classList.add("show");
          }
          return undefined;
        }
        const result = originalBegin.apply(this, arguments);
        sync();
        return result;
      };
    }

    const originalBeginAlt = window.begin;
    if (typeof originalBeginAlt === "function") {
      window.begin = function () {
        const info = sync();
        if (!info.name || !info.period) {
          if (alertEl) {
            alertEl.textContent = "Please fill in your name and select your period before starting.";
            alertEl.classList.add("show");
          }
          return undefined;
        }
        const result = originalBeginAlt.apply(this, arguments);
        sync();
        return result;
      };
    }

    nameEl.addEventListener("input", sync);
    periodEl.addEventListener("change", sync);
    sync();
  }

  function installSelectStyle() {
    if (document.getElementById("simplifiedLoginStyle")) return;
    const style = document.createElement("style");
    style.id = "simplifiedLoginStyle";
    style.textContent =
      "#studentPeriod{" +
      "width:100%;padding:12px 14px;border:1px solid rgba(31,41,55,.2);" +
      "background:#FDF8E8;color:#1F2937;font:inherit;font-size:16px;border-radius:2px;" +
      "}";
    document.head.appendChild(style);
  }

  enhanceLogin();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceLogin);
  }
  new MutationObserver(enhanceLogin).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
