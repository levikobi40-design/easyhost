const fs = require('fs');
const p = 'src/components/dashboard/StaffRosterDashboard.js';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const i = lines.findIndex((l) => l.includes("window.alert(err?.message") && l.includes('עובד'));
if (i >= 0) lines[i] = "      window.alert(err?.message || 'Could not add staff');";
fs.writeFileSync(p, lines.join('\n'));
