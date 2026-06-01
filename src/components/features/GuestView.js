import React from 'react';
import { Utensils } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { sendAIAction } from '../../services/api';
import './GuestView.css';

/**
 * Guest view component
 */
const GuestView = ({ t, lang }) => {
  const handleAIAction = async (type, room) => {
    try {
      await sendAIAction(type, room, 'guest', lang);
    } catch (error) {
      console.error('Error sending AI action:', error);
    }
  };

  return (
    <div className="guest-view fade-in">
      <div className="guest-header">
        <Utensils size={50} />
        <h2>{t.welcome}</h2>
        <p className="guest-subtitle">{t.howCanWeHelp}</p>
      </div>
      <Card className="guest-actions-card">
        <div className="card-body">
          <div className="guest-buttons">
            <Button
              variant="primary"
              size="lg"
              onClick={() => handleAIAction('towels', 'My Room')}
              className="guest-action-btn"
            >
              {t.towels}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => handleAIAction('restaurant', 'My Room')}
              className="guest-action-btn"
            >
              {t.rest}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default GuestView;
