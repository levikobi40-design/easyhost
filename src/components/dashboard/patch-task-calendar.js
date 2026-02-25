const fs = require('fs');
const p = require('path').join(__dirname, 'TaskCalendar.js');
let s = fs.readFileSync(p, 'utf8');

s = s.replace(/\{t\.description\}/g, "{typeof t.description === 'string' ? t.description : String(t.title || t.content || '')}");
s = s.replace(/\{t\.property_name\}/g, '{String(t.property_name || t.propertyName || "")}');
s = s.replace(/\{t\.staff_name\}/g, '{String(t.staff_name || t.staffName || "")}');

const phoneBlock = `{(t.staff_phone || t.phone) && (
                  <div className="task-meta-row task-phone">
                    <Phone size={16} />
                    <a href={\\"tel:\\" + String(t.staff_phone || t.phone || \\"\\").replace(/\\\\D/g, \\"\\")} className="task-phone-link">
                      {String(t.staff_phone || t.phone || \\"\\")}
                    </a>
                    <a href={\\"https://wa.me/\\" + String(t.staff_phone || t.phone || \\"\\").replace(/\\\\D/g, \\"\\").replace(/^0/, \\"972\\")} target="_blank" rel="noopener noreferrer" className="task-whatsapp-link" title="WhatsApp">
                      <MessageCircle size={14} />
                    </a>
                  </div>
                )}`;

s = s.replace(
  /\{t\.staff_phone && \(\s*<div className="task-meta-row task-phone">[\s\S]*?<\/div>\s*\)\}/,
  phoneBlock
);

s = s.replace(/t\.property_name &&/g, '(t.property_name || t.propertyName) &&');
s = s.replace(/t\.staff_name &&/g, '(t.staff_name || t.staffName) &&');
s = s.replace(/t\.staff_phone &&/g, '(t.staff_phone || t.phone) &&');

fs.writeFileSync(p, s);
console.log('Patched TaskCalendar.js');
