import React, { useEffect, useState } from 'react';
import { MessageCircle, User as UserIcon } from 'lucide-react';
import { getStaffList, getAIPropertyContext, sendMessageToPhone } from '../../services/api';

const StaffMemberCard = ({ member }) => {
  const [sending, setSending] = useState(false);
  const sendWhatsApp = async (phone, name) => {
    if (!phone) return;
    setSending(true);
    try {
      const msg = `היי ${name}, יש לך משימה חדשה במערכת. נא להיכנס לפורטל.`;
      const r = await sendMessageToPhone(phone, msg);
      if (r.success) window.alert('ההודעה נשלחה בהצלחה');
      else window.alert(r.error || 'שליחה נכשלה');
    } finally {
      setSending(false);
    }
  };

  const status = member.status === 'Busy' ? 'במשימה' : 'פנוי/ה';
  const isBusy = member.status === 'Busy';

  return (
    <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm hover:shadow-md transition-all">
      <div className="flex justify-between items-start mb-4">
        <div className="bg-gray-50 p-3 rounded-2xl">
          <UserIcon className="text-gray-400" size={24} />
        </div>
        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
          isBusy ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'
        }`}>
          {status}
        </span>
      </div>

      <h4 className="text-lg font-black text-gray-800 mb-1">{member.name || member.id}</h4>
      <p className="text-xs text-gray-400 mb-1 font-medium">
        {(member.role || 'Staff').toUpperCase()}
        {member.current_property && ` • ${member.current_property}`}
      </p>
      {(member.phone || member.phone_number) && (
        <p className="text-sm text-blue-600 font-medium mb-3">
          <a href={`tel:${(member.phone || member.phone_number || '').replace(/\D/g, '')}`} className="hover:underline">
            {member.phone || member.phone_number}
          </a>
        </p>
      )}

      <div className="flex gap-2 mt-auto">
        <button
          type="button"
          onClick={() => sendWhatsApp(member.phone || member.phone_number, member.name)}
          disabled={(!member.phone && !member.phone_number) || sending}
          className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] text-white py-2 rounded-xl text-xs font-bold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <MessageCircle size={14} />
          {sending ? 'שולח...' : 'שלח WhatsApp'}
        </button>
      </div>
    </div>
  );
};

const StaffGrid = () => {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        let data = await getStaffList();
        data = Array.isArray(data) ? data : [];
        if (mounted && data.length === 0) {
          const ctx = await getAIPropertyContext();
          const staffByProp = ctx?.staff_by_property || {};
          const props = ctx?.properties || [];
          const flat = [];
          const seen = new Set();
          for (const [pid, list] of Object.entries(staffByProp)) {
            const prop = props.find((p) => p.id === pid);
            const pName = prop?.name || '';
            for (const s of list || []) {
              const key = `${s.id || s.name}-${s.phone_number || ''}`;
              if (!seen.has(key)) {
                seen.add(key);
                flat.push({
                  id: s.id || `ps-${pid}-${s.name}`,
                  name: s.name,
                  role: s.role || 'Staff',
                  phone: s.phone_number || s.phone,
                  phone_number: s.phone_number || s.phone,
                  status: 'Idle',
                  current_property: pName,
                });
              }
            }
          }
          if (flat.length > 0) setStaff(flat);
          else setStaff(data);
        } else if (mounted) {
          setStaff(data);
        }
      } catch (e) {
        if (mounted) setStaff([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-3xl border border-gray-100 shadow-sm">
        <h3 className="text-xl font-bold text-gray-800 mb-6">צוות שטח</h3>
        <div className="py-8 text-center text-gray-400">טוען...</div>
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="p-6 bg-white rounded-3xl border border-gray-100 shadow-sm">
        <h3 className="text-xl font-bold text-gray-800 mb-6">צוות שטח</h3>
        <div className="py-8 text-center text-gray-400">אין עובדים רשומים</div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-3xl border border-gray-100 shadow-sm">
      <h3 className="text-xl font-bold text-gray-800 mb-6">צוות שטח</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {staff.map((member) => (
          <StaffMemberCard key={member.id} member={member} />
        ))}
      </div>
    </div>
  );
};

export default StaffGrid;
export { StaffMemberCard };
