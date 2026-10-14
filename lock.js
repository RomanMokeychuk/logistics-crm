/* ================================================================= *
 * FURA — БЛОКУВАННЯ PIN-КОДОМ                                        *
 *                                                                    *
 * Просить PIN з 4 цифр, коли:                                        *
 *   • вкладку закрили і відкрили CRM знову;                          *
 *   • ноутбук закривали / він засинав (понад 3 хвилини);             *
 *   • натиснули «Заблокувати».                                       *
 * Адміна не стосується. Після входу з паролем PIN не питає.          *
 *                                                                    *
 * Підключається ПІСЛЯ основного скрипта сторінки:                    *
 *   <script src="lock.js"></script>                                  *
 * ================================================================= */

(function () {
    // Сторінка відкрита всередині іншої (вкладка «Трекінг» в угоді) — тут не потрібно
    if (window.top !== window.self) return;

    const client = typeof sbClient !== "undefined" ? sbClient : null;
    if (!client) return;

    const KEY_UNLOCKED = "fura_unlocked";
    const KEY_TICK = "fura_tick";
    const KEY_RESET = "fura_reset_pin";
    const SLEEP_GAP_MS = 3 * 60 * 1000; // пауза понад 3 хв = ноутбук спав

    const ss = {
        get: (k) => {
            try {
                return sessionStorage.getItem(k);
            } catch (_) {
                return null;
            }
        },
        set: (k, v) => {
            try {
                sessionStorage.setItem(k, v);
            } catch (_) {}
        },
        del: (k) => {
            try {
                sessionStorage.removeItem(k);
            } catch (_) {}
        },
    };

    let status = null; // { has_pin, is_admin, ... }
    let locked = false;
    let overlay = null;

    /* ---------------- Стилі ---------------- */
    const style = document.createElement("style");
    style.textContent = `
    .fura-lock { position: fixed; inset: 0; z-index: 100000; visibility: visible;
        display: flex; align-items: center; justify-content: center; padding: 16px;
        background: radial-gradient(circle at 30% 20%, #1e3a8a 0%, #0f172a 60%);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .fura-lock-card { width: 100%; max-width: 340px; background: #ffffff; border-radius: 18px;
        padding: 28px 24px 22px; text-align: center; box-shadow: 0 25px 60px rgba(0,0,0,0.35); }
    .fura-lock-logo { width: 52px; height: 52px; border-radius: 14px; margin-bottom: 10px; }
    .fura-lock-title { font-size: 19px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
    .fura-lock-sub { font-size: 13px; color: #64748b; margin-bottom: 18px; min-height: 18px; }
    .fura-pin-dots { display: flex; justify-content: center; gap: 14px; margin-bottom: 8px; }
    .fura-pin-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #cbd5e1; transition: all 0.15s; }
    .fura-pin-dot.filled { background: #2563eb; border-color: #2563eb; transform: scale(1.1); }
    .fura-lock.shake .fura-pin-dots { animation: fura-shake 0.4s; }
    .fura-lock.shake .fura-pin-dot { border-color: #ef4444; }
    @keyframes fura-shake { 20%,60% { transform: translateX(-8px); } 40%,80% { transform: translateX(8px); } }
    .fura-pin-input { position: absolute; opacity: 0; pointer-events: none; width: 1px; height: 1px; }
    .fura-lock-error { font-size: 13px; color: #dc2626; min-height: 18px; margin: 6px 0 10px; }
    .fura-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 6px 6px 14px; }
    .fura-key { height: 54px; border: none; border-radius: 14px; background: #f1f5f9; color: #0f172a;
        font-size: 22px; font-weight: 600; cursor: pointer; transition: background 0.1s; }
    .fura-key:hover { background: #e2e8f0; }
    .fura-key:active { background: #cbd5e1; }
    .fura-key.ghost { background: transparent; font-size: 14px; color: #64748b; }
    .fura-lock-link { background: none; border: none; color: #2563eb; font-size: 13px; cursor: pointer; padding: 4px; }
    .fura-lock-link:hover { text-decoration: underline; }
    .fura-lock-spinner { width: 28px; height: 28px; margin: 10px auto; border: 3px solid #e2e8f0;
        border-top-color: #2563eb; border-radius: 50%; animation: fura-spin 0.8s linear infinite; }
    @keyframes fura-spin { to { transform: rotate(360deg); } }
    .fura-lock-btn { position: fixed; left: 16px; bottom: 16px; z-index: 1600; display: none;
        align-items: center; gap: 6px; padding: 7px 12px; border: none; border-radius: 999px;
        background: rgba(15,23,42,0.85); color: #e2e8f0; font-size: 12px; cursor: pointer; }
    .fura-lock-btn:hover { background: #0f172a; }`;
    document.head.appendChild(style);

    /* ---------------- Екран блокування ---------------- */
    function showOverlay(html) {
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.className = "fura-lock";
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `<div class="fura-lock-card">${html}</div>`;
    }

    function showLoading() {
        locked = true;
        showOverlay(`
            <img class="fura-lock-logo" src="logo.svg" alt="" />
            <div class="fura-lock-title">FURA</div>
            <div class="fura-lock-spinner"></div>`);
    }

    function unlock() {
        locked = false;
        ss.set(KEY_UNLOCKED, "1");
        ss.set(KEY_TICK, String(Date.now()));
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
    }

    async function signOutToLogin(resetPin) {
        if (resetPin) ss.set(KEY_RESET, "1");
        ss.del(KEY_UNLOCKED);
        try {
            await client.auth.signOut();
        } catch (_) {}
        window.location.href = "login.html";
    }

    // Екран з 4 крапками і клавіатурою. onComplete(pin) повертає текст помилки або нічого
    function pinScreen({ title, sub, onComplete, showForgot }) {
        locked = true;
        const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9]
            .map((n) => `<button type="button" class="fura-key" data-k="${n}">${n}</button>`)
            .join("");
        showOverlay(`
            <img class="fura-lock-logo" src="logo.svg" alt="" />
            <div class="fura-lock-title">${title}</div>
            <div class="fura-lock-sub">${sub || ""}</div>
            <input class="fura-pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="4" />
            <div class="fura-pin-dots">${'<div class="fura-pin-dot"></div>'.repeat(4)}</div>
            <div class="fura-lock-error"></div>
            <div class="fura-keypad">
                ${keys}
                <button type="button" class="fura-key ghost" data-k="clear">Очистити</button>
                <button type="button" class="fura-key" data-k="0">0</button>
                <button type="button" class="fura-key ghost" data-k="back">⌫</button>
            </div>
            ${showForgot ? `<button type="button" class="fura-lock-link" data-act="forgot">Забули PIN? Увійти з паролем</button><br>` : ""}
            <button type="button" class="fura-lock-link" data-act="logout">Вийти з CRM</button>`);

        const input = overlay.querySelector(".fura-pin-input");
        const dots = [...overlay.querySelectorAll(".fura-pin-dot")];
        const errorEl = overlay.querySelector(".fura-lock-error");
        let busy = false;

        const draw = () => dots.forEach((d, i) => d.classList.toggle("filled", i < input.value.length));

        async function submitIfFull() {
            draw();
            if (input.value.length < 4 || busy) return;
            busy = true;
            const err = await onComplete(input.value);
            busy = false;
            if (err) {
                errorEl.textContent = err;
                overlay.classList.add("shake");
                setTimeout(() => overlay && overlay.classList.remove("shake"), 450);
                input.value = "";
                draw();
            }
        }

        input.addEventListener("input", () => {
            input.value = input.value.replace(/\D/g, "").slice(0, 4);
            errorEl.textContent = "";
            submitIfFull();
        });
        overlay.querySelector(".fura-keypad").addEventListener("click", (e) => {
            const k = e.target.closest("[data-k]")?.dataset.k;
            if (!k || busy) return;
            errorEl.textContent = "";
            if (k === "back") input.value = input.value.slice(0, -1);
            else if (k === "clear") input.value = "";
            else if (input.value.length < 4) input.value += k;
            submitIfFull();
            input.focus({ preventScroll: true });
        });
        overlay.addEventListener("click", (e) => {
            const act = e.target.closest("[data-act]")?.dataset.act;
            if (act === "logout") signOutToLogin(false);
            if (act === "forgot") signOutToLogin(true);
        });
        // Цифри з клавіатури ноутбука
        overlay.addEventListener("keydown", (e) => {
            if (e.target !== input && /^[0-9]$/.test(e.key)) input.value += e.key;
        });
        setTimeout(() => input.focus({ preventScroll: true }), 50);
        overlay.addEventListener("click", () => input.focus({ preventScroll: true }));
    }

    function askPin() {
        pinScreen({
            title: "Введіть PIN-код",
            sub: myName ? myName : "",
            showForgot: true,
            onComplete: async (pin) => {
                const { data, error } = await client.rpc("check_my_pin", { p_pin: pin });
                if (error) return "Помилка: " + error.message;
                if (data?.ok) {
                    unlock();
                    return null;
                }
                if (data?.no_pin) {
                    createPin();
                    return null;
                }
                if (data?.locked) return `Забагато спроб. Спробуйте через ${data.wait_min} хв або увійдіть з паролем.`;
                return `Невірний PIN. Залишилось спроб: ${data?.left ?? "—"}`;
            },
        });
    }

    function createPin() {
        let first = null;
        const step1 = () =>
            pinScreen({
                title: "Створіть PIN-код",
                sub: "4 цифри — для швидкого входу після перерви",
                onComplete: async (pin) => {
                    first = pin;
                    step2();
                    return null;
                },
            });
        const step2 = () =>
            pinScreen({
                title: "Повторіть PIN-код",
                sub: "Введіть ті самі 4 цифри ще раз",
                onComplete: async (pin) => {
                    if (pin !== first) {
                        setTimeout(step1, 900);
                        return "PIN не збігається — почніть спочатку";
                    }
                    const { error } = await client.rpc("set_my_pin", { p_pin: pin });
                    if (error) return error.message;
                    ss.del(KEY_RESET);
                    if (status) status.has_pin = true;
                    unlock();
                    return null;
                },
            });
        step1();
    }

    function lockNow() {
        if (locked || !status || status.is_admin || !status.in_staff) return;
        ss.del(KEY_UNLOCKED);
        if (status.has_pin) askPin();
        else createPin();
    }

    /* ---------------- Старт ---------------- */
    let myName = "";
    const needLockOnStart =
        ss.get(KEY_UNLOCKED) !== "1" ||
        Date.now() - (Number(ss.get(KEY_TICK)) || Date.now()) > SLEEP_GAP_MS;

    // Закриваємо екран одразу, поки перевіряємо — щоб нічого не "мигнуло"
    if (needLockOnStart) showLoading();

    async function start() {
        const {
            data: { session },
        } = await client.auth.getSession();
        if (!session) return; // сторінка сама відправить на login.html

        const { data, error } = await client.rpc("pin_status");
        if (error) {
            // pin.sql ще не виконано — не блокуємо роботу
            console.warn("FURA PIN: функції ще не створені в базі (pin.sql)", error.message);
            unlock();
            return;
        }
        status = data;

        try {
            const { data: me } = await client
                .from("staff")
                .select("full_name")
                .eq("email", (session.user?.email || "").toLowerCase())
                .maybeSingle();
            myName = me?.full_name || "";
        } catch (_) {}

        // Адмін і люди поза списком співробітників — без PIN
        if (status.is_admin || !status.in_staff) {
            unlock();
            return;
        }

        // Щойно увійшли з паролем (або «забули PIN») — пропонуємо створити PIN
        if (!status.has_pin || (ss.get(KEY_RESET) === "1" && status.recent_login)) {
            createPin();
            return;
        }

        if (needLockOnStart) askPin();
        else unlock();

        // Кнопка «Заблокувати» в куті
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fura-lock-btn";
        btn.style.display = "inline-flex";
        btn.title = "Заблокувати CRM (наприклад, коли відходите від комп'ютера)";
        btn.innerHTML = "🔒 Заблокувати";
        btn.addEventListener("click", lockNow);
        document.body.appendChild(btn);
    }

    // Ноутбук заснув / закрили кришку: таймер "застиг" надовго
    setInterval(() => {
        const now = Date.now();
        const last = Number(ss.get(KEY_TICK)) || now;
        if (!locked && now - last > SLEEP_GAP_MS) lockNow();
        if (!locked) ss.set(KEY_TICK, String(now));
    }, 5000);

    document.addEventListener("visibilitychange", () => {
        if (document.hidden || locked) return;
        const last = Number(ss.get(KEY_TICK)) || Date.now();
        if (Date.now() - last > SLEEP_GAP_MS) lockNow();
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
