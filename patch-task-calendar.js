const fs = require('fs');
const p = 'src/components/dashboard/TaskCalendar.js';
let s = fs.readFileSync(p, 'utf8');

// Fix task.description render - never render object
s = s.replace(/\{t\.description\}/g, "{typeof t.description === 'string' ? t.description : String(t.title || t.content || '')}");

// Fix property_name
s = s.replace(/\{t\.property_name\}/g, '{String(t.property_name || t.propertyName || "")}');

// Fix staff_name
s = s.replace(/\{t\.staff_name\}/g, '{String(t.staff_name || t.staffName || "")}');

// Fix staff_phone - use String and add WhatsApp button
s = s.replace(
  /\{t\.staff_phone && \(\s*<div className="task-meta-row task-phone">\s*<Phone size=\{16\} \/>\s*<a href=\{`tel:\$\{t\.staff_phone\}`\} className="task-phone-link">\s*\{t\.staff_phone\}\s*<\/a>\s*<\/div>\s*\)\}/,
  `{(t.staff_phone || t.phone) && (
                  <div className="task-meta-row task-phone">
                    <Phone size={16} />
                    <a href={\\"tel:\\" + String(t.staff_phone || t.phone || \\"\\").replace(/\\\\D/g, \\"\\")} className="task-phone-link">
                      {String(t.staff_phone || t.phone || \\"\\")}
                    </a>
                    <a href={\\"https://wa.me/\\" + String(t.staff_phone || t.phone || \\"\\").replace(/\\\\D/g, \\"\\").replace(/^0/, \\"972\\")} target="_blank" rel="noopener noreferrer" className="task-whatsapp-link" title="WhatsApp">
                      <MessageCircle size={14} />
                    </a>
                  </div>
                )}`
);

// Update conditions to support both snake_case and camelCase
s = s.replace(/t\.property_name &&/, '(t.property_name || t.propertyName) &&');
s = s.replace(/t\.staff_name &&/, '(t.staff_name || t.staffName) &&');
s = s.replace(/t\.staff_phone &&/, '(t.staff_phone || t.phone) &&');

fs.writeFileSync(p, s);
console.log('Patched TaskCalendar.js');
