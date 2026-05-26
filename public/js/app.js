/* ==========================================================================
   App JS — sidebar toggle, theme toggle, user dropdown, toasts, charts
   ========================================================================== */
(function () {
  'use strict';

  // ---- Theme (light/dark) ----
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

  document.addEventListener('DOMContentLoaded', () => {
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      themeBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
      themeBtn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        if (cur === 'dark') {
          document.documentElement.removeAttribute('data-theme');
          localStorage.removeItem('theme');
          themeBtn.textContent = '🌙';
        } else {
          document.documentElement.setAttribute('data-theme', 'dark');
          localStorage.setItem('theme', 'dark');
          themeBtn.textContent = '☀️';
        }
      });
    }

    // ---- Sidebar (mobile) ----
    const toggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    }

    // ---- User dropdown ----
    const userBtn = document.getElementById('userMenuBtn');
    const userDd  = document.getElementById('userDropdown');
    if (userBtn && userDd) {
      userBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDd.hidden = !userDd.hidden;
      });
      document.addEventListener('click', () => { userDd.hidden = true; });
    }

    // ---- Toast auto-dismiss ----
    document.querySelectorAll('.toast[data-auto-dismiss]').forEach(t => {
      const close = () => t.remove();
      const btn = t.querySelector('.toast-close');
      if (btn) btn.addEventListener('click', close);
      setTimeout(close, 4500);
    });
  });

  // ---- Chart helpers (Chart.js) ----
  const palette = ['#4f46e5','#0ea5e9','#16a34a','#f59e0b','#dc2626','#8b5cf6','#06b6d4','#f97316','#10b981','#6366f1'];

  function chartOptions() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const color  = isDark ? '#cbd5e1' : '#475569';
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color, font: { size: 11 } }, grid: { color: isDark ? '#334155' : '#e5e7eb' }, beginAtZero: true },
      },
    };
  }

  window.makeBarChart = function (id, labels, data) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    new Chart(el, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: '#4f46e5', borderRadius: 4 }] },
      options: { ...chartOptions(), plugins: { legend: { display: false } } },
    });
  };

  window.makePieChart = function (id, labels, data) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    new Chart(el, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: palette }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 },
          color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#cbd5e1' : '#475569' } } },
      },
    });
  };
})();
