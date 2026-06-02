-- ============================================
-- Easy Hotel AI - Core PostgreSQL Schema
-- הרצה: psql $DATABASE_URL -f migrations/001_core_schema.sql
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. טבלת בעלי הנכסים (Tenants)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    plan TEXT DEFAULT 'trial', -- trial, pro, enterprise
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. טבלת משתמשים (עובדים וסוכנים)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT CHECK (role IN ('admin', 'manager', 'cleaner', 'maintenance', 'reception')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(tenant_id, role);

-- 3. טבלת נכסים (חדרים / וילות / דירות)
CREATE TABLE IF NOT EXISTS properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    external_id TEXT, -- ה-ID מ-Airbnb/Booking
    title TEXT NOT NULL,
    cover_image TEXT,
    address JSONB, -- כתובת מלאה בפורמט JSON
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_tenant ON properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_properties_external ON properties(external_id);

-- 4. טבלת הזמנות (Bookings)
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    guest_name TEXT NOT NULL,
    guest_phone TEXT,
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    status TEXT DEFAULT 'upcoming', -- upcoming, checked_in, checked_out, cancelled
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_tenant ON bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_property ON bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(tenant_id, status);

-- 5. טבלת משימות (המרכז התפעולי)
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    type TEXT CHECK (type IN ('cleaning', 'maintenance', 'inspection')),
    status TEXT DEFAULT 'pending', -- pending, in_progress, completed
    priority TEXT DEFAULT 'normal',
    due_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE status = 'pending';

-- 6. טבלת אירועים (Audit / Activity Log)
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id), -- מי ביצע את הפעולה (המנקה? המערכת?)
    event_type TEXT NOT NULL, -- למשל: 'booking.created', 'task.completed'
    payload JSONB NOT NULL, -- כל הנתונים הנוספים (למשל: סכום ההזמנה)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_type ON events(tenant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
