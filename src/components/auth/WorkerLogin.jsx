import React from 'react';
import FieldView from '../features/FieldView';

/**
 * Field clock-in that navigates to the Bikta matrix (SPA) on success — no full page reload.
 * Open via /worker-login or use from routing.
 */
export default function WorkerLogin() {
  return (
    <FieldView clockInOnly autoClockInOnScan clockInRedirectPath="/bikta-matrix" />
  );
}
