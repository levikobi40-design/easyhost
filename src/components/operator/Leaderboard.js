import React, { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { getLeaderboard } from '../../services/api';
import './Leaderboard.css';

const Leaderboard = () => {
  const [leaders, setLeaders] = useState([]);

  const load = async () => {
    try {
      const data = await getLeaderboard();
      setLeaders(data);
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="leaderboard glass-card">
      <div className="leaderboard-header">
        <h3><Trophy size={18} /> Leaderboard</h3>
      </div>
      <div className="leaderboard-list">
        {leaders.length === 0 ? (
          <div className="leaderboard-empty">No scores yet.</div>
        ) : (
          leaders.map((leader, idx) => (
            <div key={leader.id} className="leaderboard-row">
              <span className="leader-rank">#{idx + 1}</span>
              <span className="leader-name">{leader.name || leader.id}</span>
              <span className="leader-points">{leader.points} pts</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Leaderboard;
