import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_URL } from '../../utils/apiClient';

export default function WorkerPage() {
  const { id } = useParams();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = API_URL.replace(/\/$/, '');
    if (!id) {
      console.log('[WorkerPage] missing route param id');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`${base}/my-tasks?worker_id=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        console.log('[WorkerPage] /my-tasks', res.status, data);
        if (!res.ok) {
          setTasks([]);
          return;
        }
        const list = Array.isArray(data) ? data : [];
        if (!cancelled) setTasks(list);
      })
      .catch((err) => {
        console.error('[WorkerPage] fetch error', err);
        if (!cancelled) setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <p style={{ padding: 16 }}>Loading…</p>;

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: '0 0 12px' }}>Worker {id}</h1>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {tasks.map((t) => (
          <li key={t.id}>{t.description || t.task_type || String(t.id)}</li>
        ))}
      </ul>
      {tasks.length === 0 ? <p style={{ color: '#666' }}>No tasks</p> : null}
    </div>
  );
}
