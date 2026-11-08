const os = require('node:os');
const fs = require('node:fs/promises');
const version = require('../app/version.cjs');
async function diagnostics(store, settings, messaging, backups) {
  const stat = await fs.statfs(store.root);
  const audits = store.auditList();
  const summary = row => ({ event: row.event, at: row.createdAt, code: row.metadata.code, version: row.metadata.version, status: row.metadata.status });
  return {
    format: 1, generatedAt: new Date().toISOString(), version,
    platform: os.platform(), architecture: os.arch(), osRelease: os.release(),
    components: { electron: process.versions.electron || null, node: process.versions.node, chrome: process.versions.chrome || null, sqlite: store.db.prepare('SELECT sqlite_version() AS version').get().version },
    database: { integrity: store.integrity() ? 'ok' : 'error', migrations: store.db.prepare('SELECT name,applied_at AS appliedAt FROM migrations ORDER BY name').all() },
    services: { whatsapp: messaging.status().whatsapp.status, email: messaging.status().email, queue: { pending: messaging.status().pending } },
    updates: { channel: settings.get().channel, lastCheck: settings.get().lastCheck, lastUpdate: settings.get().lastUpdate, recent: audits.filter(row => row.event.startsWith('update.')).slice(0, 20).map(summary) },
    recentErrors: audits.filter(row => row.event.includes('failed')).slice(0, 20).map(summary),
    disk: { availableBytes: Number(stat.bavail) * Number(stat.bsize) },
    backups: backups.list().map(b => ({ createdAt: b.createdAt, version: b.version, bytes: b.bytes, runtime: b.runtime })).slice(0, 20)
  };
}
module.exports = { diagnostics };
