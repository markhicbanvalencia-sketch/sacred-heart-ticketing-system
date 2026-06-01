(function () {
  'use strict';

  const isStaff   = window.__RT_STAFF   === true;
  const ticketId  = window.__RT_TICKET  || null;
  const initLastId = window.__RT_LAST_COMMENT || 0;

  let lastCommentId = initLastId;

  // ── SSE connection (all logged-in users) ──────────────────────────────────
  if (window.__RT_USER) {
    const src = new EventSource('/events');

    // Close the connection immediately when the user navigates away.
    // Without this, browsers queue the new page request behind the open SSE
    // connection (HTTP/1.1 has a 6-connection-per-host limit).
    window.addEventListener('beforeunload', function () { src.close(); });

    src.onmessage = function (e) {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }

      // Notification badge update
      if ((data.type === 'notif' || data.type === 'init') && isStaff) {
        updateBadge(data.notifCount || 0);
        if (data.type === 'notif') toast('🔔 ' + data.message);
      }

      // New ticket → show refresh banner on list page
      if (data.type === 'ticket_new' && isStaff && document.getElementById('ticketTableBody')) {
        showRefreshBanner('New ticket submitted — ');
      }

      // Ticket updated while viewing it → reload sidebar details silently
      if (data.type === 'ticket_update' && ticketId && data.ticketId == ticketId) {
        showRefreshBanner('This ticket was updated — ');
      }

      // New comment on current ticket → fetch it immediately
      if (data.type === 'comment' && ticketId && data.ticketId == ticketId) {
        fetchComments();
      }
    };

    src.onerror = function () { /* browser auto-reconnects */ };
  }

  // ── Comment polling fallback (5 s) for pages without SSE push ────────────
  if (ticketId) {
    const _pollTimer = setInterval(fetchComments, 5000);
    window.addEventListener('beforeunload', function () { clearInterval(_pollTimer); });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fetchComments() {
    fetch('/tickets/' + ticketId + '/comments.json?after=' + lastCommentId, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.comments || data.comments.length === 0) return;
        var list = document.getElementById('commentList');
        if (!list) return;
        data.comments.forEach(function (c) {
          var li = document.createElement('li');
          li.className = 'comment' + (c.is_internal ? ' internal' : '');
          li.dataset.id = c.id;
          li.innerHTML =
            '<div class="comment-head">' +
              '<span class="avatar">' + esc(c.user_name.charAt(0).toUpperCase()) + '</span>' +
              '<div>' +
                '<strong>' + esc(c.user_name) + '</strong>' +
                '<span class="badge badge-info small">' + esc(c.role.replace('_', ' ')) + '</span>' +
                (c.is_internal ? '<span class="badge badge-warning small">internal note</span>' : '') +
                '<div class="muted small">' + esc(c.created_at) + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="comment-body prewrap">' + esc(c.body) + '</div>';
          list.appendChild(li);
          lastCommentId = Math.max(lastCommentId, c.id);
        });
        // Hide "No comments yet" placeholder
        var placeholder = document.getElementById('noComments');
        if (placeholder) placeholder.remove();
      })
      .catch(function () {});
  }

  function updateBadge(count) {
    var btn = document.querySelector('.notif-btn');
    if (!btn) return;
    var badge = btn.querySelector('.notif-badge');
    if (count > 0) {
      var label = count > 99 ? '99+' : String(count);
      if (badge) {
        badge.textContent = label;
      } else {
        badge = document.createElement('span');
        badge.className = 'notif-badge';
        badge.textContent = label;
        btn.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  }

  function showRefreshBanner(msg) {
    if (document.getElementById('rt-refresh-banner')) return;
    var b = document.createElement('div');
    b.id = 'rt-refresh-banner';
    b.className = 'rt-refresh-banner';
    b.innerHTML = msg + '<button onclick="location.reload()">Refresh now</button>' +
      '<button onclick="this.parentElement.remove()" style="margin-left:8px;opacity:.6;">✕</button>';
    var content = document.querySelector('.content');
    if (content) content.insertBefore(b, content.firstChild);
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'rt-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('rt-toast-show'); });
    setTimeout(function () {
      t.classList.remove('rt-toast-show');
      setTimeout(function () { t.remove(); }, 350);
    }, 4500);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
