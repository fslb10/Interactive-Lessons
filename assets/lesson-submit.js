(function () {
  const ENDPOINT =
    "https://okieanoysldlblqdtrau.supabase.co/functions/v1/lesson-submission";
  const AUTOSAVE_DELAY_MS = 12000;
  const AUTOSAVE_INTERVAL_MS = 60000;

  let draftTimer = null;
  let draftInFlight = false;
  let draftQueued = false;
  let lastDraftAt = 0;
  let lastDraftBody = "";

  function getGlobal(name) {
    try {
      return Function("return typeof " + name + " !== 'undefined' ? " + name + " : undefined")();
    } catch {
      return undefined;
    }
  }

  function callGlobal(name) {
    const fn = getGlobal(name);
    if (typeof fn !== "function") return undefined;
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function words(value) {
    const s = text(value).trim();
    return s ? s.split(/\s+/).length : 0;
  }

  function getLessonMeta() {
    const explicit = getGlobal("LESSON_SUBMISSION_META") || getGlobal("LESSON_META");
    if (explicit && typeof explicit === "object") {
      return {
        unit: text(explicit.unit),
        lesson: text(explicit.lesson),
        lesson_title: text(explicit.lesson_title || explicit.title),
      };
    }

    const path = window.location.pathname;
    const match = path.match(/\/(Unit-\d+|unit-\d+)\/apps\/(\d+)-(\d+)-[^/]+\.html$/i);
    const unitNumber = match ? match[1].match(/\d+/)[0] : "";
    const lesson = match ? unitNumber + "." + match[3] : "";
    const titleText = document.title || "";
    const title = titleText.includes(":")
      ? titleText.split(":").slice(1).join(":").trim()
      : titleText.replace(/^HRE4M1\s*(?:\u00b7|-)\s*/i, "").trim();

    return {
      unit: unitNumber ? "Unit " + unitNumber : "",
      lesson,
      lesson_title: title,
    };
  }

  function getState() {
    return getGlobal("state") || {};
  }

  function getStudentInfo(state) {
    const info = state.studentInfo || state.student || {};
    const name =
      info.name ||
      document.getElementById("studentName")?.value ||
      document.querySelector("input[autocomplete='name']")?.value ||
      "";
    const period =
      info.period ||
      document.getElementById("studentPeriod")?.value ||
      "";
    const classPeriod =
      info.classPeriod ||
      info.className ||
      info.class ||
      document.getElementById("studentClass")?.value ||
      (period ? "Period " + period : "");
    const explicitEmail =
      info.email ||
      document.getElementById("studentEmail")?.value ||
      document.querySelector("input[type='email']")?.value ||
      "";
    const trimmedName = text(name).trim();
    const trimmedPeriod = text(classPeriod).trim();
    const email = text(explicitEmail).trim() || makeSyntheticEmail(trimmedName, trimmedPeriod || text(period).trim());

    return {
      student_name: trimmedName,
      student_email: email,
      class_period: trimmedPeriod,
    };
  }

  function makeSyntheticEmail(name, classPeriod) {
    if (!name || !classPeriod) return "";
    const slug = (name + "-" + classPeriod)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return (slug || "student") + "@lesson.local";
  }

  function getResponses(state) {
    const responseState = state.responses || {};
    const order = getGlobal("RESPONSE_ORDER");
    const titles = getGlobal("RESPONSE_TITLES") || {};
    const prompts = getGlobal("PROMPTS") || {};
    const result = {};
    const keys = Array.isArray(order) && order.length ? order : Object.keys(responseState);

    keys.forEach((key) => {
      const label = titles[key] || prompts[key] || key;
      result[label] = responseState[key] ?? "";
    });

    Object.keys(responseState).forEach((key) => {
      const label = titles[key] || prompts[key] || key;
      if (!(label in result)) result[label] = responseState[key] ?? "";
    });

    return result;
  }

  function getQuizAnswers(state) {
    const quiz = getGlobal("QUIZ") || [];
    const quizState = state.quiz || {};
    const answers =
      quizState.answers && typeof quizState.answers === "object"
        ? quizState.answers
        : quizState && typeof quizState === "object"
          ? quizState
          : {};

    if (!Array.isArray(quiz) || quiz.length === 0) return answers;

    return quiz.map((q, index) => {
      const id = q.id || String(index);
      const selected =
        answers[id] !== undefined
          ? answers[id]
          : answers[index] !== undefined
            ? answers[index]
            : null;
      const options = q.opts || q.options || [];
      const correct = q.correct !== undefined ? q.correct : q.answer;

      return {
        question: q.q || q.question || "",
        selected_index: selected,
        selected_text: selected !== null && options[selected] !== undefined ? options[selected] : null,
        correct_index: correct ?? null,
        correct_text: correct !== undefined && options[correct] !== undefined ? options[correct] : null,
      };
    });
  }

  function getQuizScore(state, quizAnswers) {
    if (typeof state.quiz?.scoreCount === "number") return state.quiz.scoreCount;
    const quiz = getGlobal("QUIZ") || [];
    if (!Array.isArray(quiz) || !Array.isArray(quizAnswers)) return null;
    return quizAnswers.reduce((score, answer, index) => {
      const correct = quiz[index]?.correct !== undefined ? quiz[index].correct : quiz[index]?.answer;
      return score + (answer.selected_index !== null && answer.selected_index === correct ? 1 : 0);
    }, 0);
  }

  function getTotalWords(responses) {
    const total = callGlobal("totalWords");
    if (typeof total === "number" && Number.isFinite(total)) return total;
    return Object.values(responses).reduce((sum, value) => sum + words(value), 0);
  }

  function getTimeSpentSeconds(state) {
    const ms = callGlobal("totalTimeMs");
    if (typeof ms === "number" && Number.isFinite(ms)) return Math.max(0, Math.round(ms / 1000));
    if (typeof state.startedMs === "number") return Math.max(0, Math.round((Date.now() - state.startedMs) / 1000));
    if (state.startedAt) {
      const started = Date.parse(state.startedAt);
      const finished = state.finishedAt ? Date.parse(state.finishedAt) : Date.now();
      if (Number.isFinite(started) && Number.isFinite(finished)) {
        return Math.max(0, Math.round((finished - started) / 1000));
      }
    }
    return null;
  }

  function buildPayload(status) {
    callGlobal("persistInputsToState");
    const state = getState();
    const responses = getResponses(state);
    const quizAnswers = getQuizAnswers(state);

    return {
      ...getStudentInfo(state),
      ...getLessonMeta(),
      responses,
      quiz_answers: quizAnswers,
      quiz_score: getQuizScore(state, quizAnswers),
      total_words: getTotalWords(responses),
      time_spent_seconds: getTimeSpentSeconds(state),
      status,
    };
  }

  function hasStudentIdentity(payload) {
    return Boolean(payload.student_name && payload.student_email);
  }

  function saveToBrowser() {
    const saved = callGlobal("saveLocal");
    if (saved === undefined) {
      callGlobal("persistInputsToState");
    }
  }

  function markSavedLocally(message) {
    callGlobal("markSaveButtonsSaved");
    const showToast = getGlobal("showToast");
    if (message && typeof showToast === "function") {
      try {
        showToast(message);
      } catch {
        // Toasts are a convenience only; saving should not depend on them.
      }
    }
  }

  function setStatus(message, kind) {
    const el = document.getElementById("lessonSubmitStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind || "info";
  }

  function setBusy(buttonId, busy, busyText, idleText) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? busyText : idleText;
  }

  function confirmSubmissionOverwrite() {
    return window.confirm(
      "Submit this lesson to your teacher?\n\nIf you already submitted this lesson, this will replace your previous submission for this same lesson.",
    );
  }

  async function postPayload(payload) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      throw new Error(body.error || "Save failed");
    }
    return body;
  }

  async function saveDraft(options) {
    const mode = options?.mode || "auto";
    saveToBrowser();

    const payload = buildPayload("draft");
    if (!hasStudentIdentity(payload)) {
      if (mode === "manual") {
        setStatus("Saved on this device. Enter name and period to save to the teacher dashboard.", "info");
        markSavedLocally("Saved on this device.");
      }
      return false;
    }

    const bodyText = JSON.stringify(payload);
    if (mode !== "manual" && bodyText === lastDraftBody) return true;

    const now = Date.now();
    if (mode !== "manual" && now - lastDraftAt < AUTOSAVE_INTERVAL_MS) {
      scheduleDraftSave(AUTOSAVE_INTERVAL_MS - (now - lastDraftAt));
      return true;
    }

    if (draftInFlight) {
      draftQueued = true;
      return true;
    }

    draftInFlight = true;
    if (mode === "manual") {
      setBusy("lessonSaveButton", true, "Saving...", "Save Draft");
      setStatus("Saving draft to teacher dashboard...", "info");
    }

    try {
      const body = await postPayload(payload);
      const state = getState();
      if (body.ignored_draft) {
        lastDraftAt = Date.now();
        lastDraftBody = bodyText;
        setStatus(
          mode === "manual"
            ? "This lesson is already submitted. Submit again to replace the previous submission."
            : "Already submitted. Submit again to replace the previous submission.",
          "info",
        );
        return true;
      }
      state.savedToDatabaseAt = new Date().toISOString();
      state.draftSubmissionId = body.id || state.draftSubmissionId;
      lastDraftAt = Date.now();
      lastDraftBody = bodyText;
      saveToBrowser();
      markSavedLocally(mode === "manual" ? "Draft saved." : "");
      setStatus(mode === "manual" ? "Draft saved to the teacher dashboard." : "Autosaved to the teacher dashboard.", "success");
      return true;
    } catch (error) {
      if (mode === "manual") {
        setStatus("Saved on this device, but the database save failed. Try Save Draft again.", "error");
      }
      console.error("Lesson draft save failed:", error);
      return false;
    } finally {
      draftInFlight = false;
      if (mode === "manual") {
        setBusy("lessonSaveButton", false, "Saving...", "Save Draft");
      }
      if (draftQueued) {
        draftQueued = false;
        scheduleDraftSave(1000);
      }
    }
  }

  function scheduleDraftSave(delay) {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      saveDraft({ mode: "auto" });
    }, typeof delay === "number" ? delay : AUTOSAVE_DELAY_MS);
  }

  function installDraftSave() {
    const originalSaveProgress = window.saveProgressNow;
    window.downloadProgressBackup = function () {
      if (typeof originalSaveProgress === "function") {
        return originalSaveProgress.apply(this, arguments);
      }
      saveToBrowser();
      setStatus("Saved on this device. Progress download is not available for this lesson.", "info");
      return undefined;
    };
    window.saveProgressNow = function () {
      return saveDraft({ mode: "manual" });
    };
    window.saveLessonDraft = window.saveProgressNow;
  }

  function addAutosaveListeners() {
    document.addEventListener("input", (event) => {
      if (event.target?.matches?.("input, textarea, select")) scheduleDraftSave();
    });
    document.addEventListener("change", (event) => {
      if (event.target?.matches?.("input, textarea, select")) scheduleDraftSave();
    });
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.(".check-option, .q-option, .term-card, button[data-answer], button[data-opt]")) {
        scheduleDraftSave();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveDraft({ mode: "auto" });
    });
  }

  async function submitLesson() {
    const payload = buildPayload("submitted");

    if (!payload.student_name || !payload.student_email) {
      setStatus("Enter your name and period before submitting.", "error");
      return;
    }

    if (!confirmSubmissionOverwrite()) {
      setStatus("Submission cancelled. Your previous submission was not changed.", "info");
      return;
    }

    setBusy("lessonSubmitButton", true, "Submitting...", "Submit Lesson");
    setStatus("Sending to teacher dashboard...", "info");

    try {
      const body = await postPayload(payload);

      const state = getState();
      state.finishedAt = state.finishedAt || new Date().toISOString();
      state.submittedAt = new Date().toISOString();
      state.submissionId = body.id;
      callGlobal("saveLocal");
      setStatus("Submitted. Your teacher can now see this lesson.", "success");
    } catch (error) {
      setStatus("Could not submit. Please try again or use Download Report.", "error");
      console.error("Lesson submission failed:", error);
    } finally {
      setBusy("lessonSubmitButton", false, "Submitting...", "Submit Lesson");
    }
  }

  function addSubmitControls() {
    if (document.getElementById("lessonSubmitPanel")) return;

    const style = document.createElement("style");
    style.textContent = `
      #lessonSubmitPanel {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 9999;
        width: min(320px, calc(100vw - 36px));
        padding: 12px;
        border: 1px solid rgba(31, 41, 55, 0.18);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.2);
        color: #1f2937;
        font-family: Arial, Helvetica, sans-serif;
      }
      #lessonSubmitPanel .submit-title {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      #lessonSubmitButton {
        width: 100%;
        min-height: 42px;
        border: 0;
        border-radius: 8px;
        background: #1f2937;
        color: #fff;
        font-weight: 800;
        cursor: pointer;
      }
      #lessonSubmitPanel .submit-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }
      #lessonSaveButton {
        width: 100%;
        min-height: 38px;
        border: 1px solid rgba(31, 41, 55, 0.3);
        border-radius: 8px;
        background: #fff;
        color: #1f2937;
        font-weight: 800;
        cursor: pointer;
      }
      #lessonSubmitButton:disabled,
      #lessonSaveButton:disabled {
        cursor: wait;
        opacity: 0.72;
      }
      #lessonSubmitStatus {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.4;
      }
      #lessonSubmitStatus[data-kind="success"] { color: #166534; }
      #lessonSubmitStatus[data-kind="error"] { color: #991b1b; }
      @media (max-width: 700px) {
        #lessonSubmitPanel {
          right: 12px;
          bottom: 12px;
          width: calc(100vw - 24px);
        }
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("aside");
    panel.id = "lessonSubmitPanel";
    panel.setAttribute("aria-label", "Lesson submission");
    panel.innerHTML =
      '<p class="submit-title">Teacher Submission</p>' +
      '<div class="submit-actions">' +
      '<button id="lessonSaveButton" type="button">Save Draft</button>' +
      '<button id="lessonSubmitButton" type="button">Submit Lesson</button>' +
      '</div>' +
      '<p id="lessonSubmitStatus" data-kind="info">Autosaves after students enter name and period.</p>';
    document.body.appendChild(panel);

    document.getElementById("lessonSaveButton").addEventListener("click", () => saveDraft({ mode: "manual" }));
    document.getElementById("lessonSubmitButton").addEventListener("click", submitLesson);
  }

  installDraftSave();
  addAutosaveListeners();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addSubmitControls);
  } else {
    addSubmitControls();
  }
})();
