import React from 'react';
import { Bell } from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import Card from '../ui/Card';
import Button from '../ui/Button';
import './StaffView.css';

/**
 * Staff view component
 */
const StaffView = () => {
  const { t: translate } = useTranslations();
  return (
    <div className="staff-view fade-in">
      <div className="staff-header">
        <Bell size={50} />
        <h2>{translate('roles.staff')} Dashboard</h2>
      </div>
      <Card className="task-card">
        <div className="card-body">
          <p className="task-description">
            {translate('staffView.openTask')}: Cleaning Room 101
          </p>
          <Button variant="secondary" className="task-button">
            {translate('common.close')}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default StaffView;
