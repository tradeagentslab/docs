// The site's only script file (loaded with defer). Everything works without it; it adds:
// the theme button (auto -> dark -> light, remembered in localStorage), and on the home page
// the install tabs, the copy button, and board row <-> chart line highlighting.
// A tiny inline script in <head> applies a remembered theme before the first paint.
(function () {
  var root = document.documentElement;
  var KEY = "tal-theme";
  function get() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function set(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked: still works for this page */ }
  }

  // Theme
  var btn = document.getElementById("themeBtn");
  var lbl = document.getElementById("themeLbl");
  function applyTheme(t) {
    if (t === "dark" || t === "light") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
    if (lbl) lbl.textContent = t === "dark" || t === "light" ? t : "auto";
  }
  applyTheme(get());
  if (btn) {
    btn.addEventListener("click", function () {
      var cur = root.getAttribute("data-theme");
      var next = !cur ? "dark" : cur === "dark" ? "light" : null;
      applyTheme(next);
      set(next || "auto");
    });
  }

  // Install tabs: the command is the same for every app; the app's name changes in the text.
  var tabs = [].slice.call(document.querySelectorAll(".tab"));
  var panel = document.querySelector(".inst");
  function pick(t) {
    tabs.forEach(function (x) {
      var on = x === t;
      x.setAttribute("aria-selected", on ? "true" : "false");
      x.tabIndex = on ? 0 : -1;
    });
    if (panel) panel.setAttribute("aria-labelledby", t.id);
    [].forEach.call(document.querySelectorAll(".appn"), function (n) {
      n.textContent = t.getAttribute("data-app");
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { pick(t); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      var next = tabs[(i + d + tabs.length) % tabs.length];
      pick(next);
      next.focus();
      e.preventDefault();
    });
  });

  // Copy button
  var cb = document.getElementById("copyBtn");
  var cmd = document.getElementById("cmdText");
  if (cb && cmd) {
    cb.addEventListener("click", function () {
      var label = cb.textContent;
      var done = function () {
        cb.textContent = "✓";
        setTimeout(function () { cb.textContent = label; }, 1400);
      };
      var select = function () {
        var r = document.createRange();
        r.selectNodeContents(cmd);
        var s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd.textContent).then(done, select);
      } else {
        select();
      }
    });
  }

  // Board row <-> chart line
  var chart = document.getElementById("chart");
  if (chart) {
    var focus = function (k) {
      chart.classList.toggle("focus", !!k);
      [].forEach.call(chart.querySelectorAll("[data-s]"), function (el) {
        el.classList.toggle("on", el.getAttribute("data-s") === k);
      });
      [].forEach.call(document.querySelectorAll(".board tbody tr"), function (r) {
        r.classList.toggle("on", r.getAttribute("data-s") === k);
      });
    };
    [].forEach.call(document.querySelectorAll(".board tbody tr[data-s], .chart .ln, .chart .lb"), function (el) {
      el.addEventListener("mouseenter", function () { focus(el.getAttribute("data-s")); });
      el.addEventListener("mouseleave", function () { focus(null); });
    });
  }
})();
