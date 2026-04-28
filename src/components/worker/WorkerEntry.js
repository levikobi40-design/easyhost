import React from 'react';
import { useParams } from 'react-router-dom';
import useStore from '../../store/useStore';
import StaffDashboard from '../dashboard/StaffDashboard';
import WorkerView from '../WorkerView';
import BiktaDashboard from '../bikta/BiktaDashboard';

const BIKTA_ENV = process.env.REACT_APP_BIKTA_TENANT_ID;

/**
 * /worker/:id — field worker missions
 * /worker — StaffDashboard
 * When tenant is הבקתה נס ציונה (BIKTA_NESS_ZIONA), show Bikta matrix instead of list.
 */
export default function WorkerEntry() {
  const { id } = useParams();
  const activeTenantId = useStore((s) => s.activeTenantId);

  if (activeTenantId === 'BIKTA_NESS_ZIONA' || (BIKTA_ENV && activeTenantId === BIKTA_ENV)) {
    return <BiktaDashboard />;
  }
  if (!id) return <StaffDashboard />;
  return <WorkerView />;
}
