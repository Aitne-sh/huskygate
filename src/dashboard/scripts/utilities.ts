/** @module dashboard/scripts/utilities — Client-side script for restart banner and shared UI utilities. */
export const utilitiesScript = `
    /* ══════════════════════════════════════════════
       Restart Banner
       ══════════════════════════════════════════════ */

    var restartPendingKeys = [];

    function showRestartBanner(keys) {
      restartPendingKeys = keys;
      document.getElementById('restart-keys').textContent = keys.join(', ');
      document.getElementById('restart-banner').classList.add('visible');
    }

    function dismissRestart() {
      document.getElementById('restart-banner').classList.remove('visible');
      restartPendingKeys = [];
    }

    async function restartServer() {
      toast('Restarting server...', 'success');
      // Stop then start
      await fetchApi('/api/daemon/stop', { method: 'POST' });
      // Brief delay to let process exit
      await new Promise(function(r) { setTimeout(r, 1500); });
      await fetchApi('/api/daemon/start', { method: 'POST' });
      dismissRestart();
      // Recheck status after a moment
      setTimeout(function() { checkServerOnline(); refreshOverview(); }, 2000);
    }

`;
