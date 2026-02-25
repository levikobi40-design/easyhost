import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Languages, Wrench, Sparkles, Brush, AlertTriangle } from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import { setWorkerLanguage, clockInStaff, getStaffTasks, updateStaffTaskStatus, subscribeToStaff, updateStaffLocation, reportIssue } from '../../services/api';
import './FieldView.css';

const MARKET_LANGUAGES = {
  US: [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
  ],
  IL: [
    { code: 'he', label: 'Hebrew' },
    { code: 'th', label: 'Thai' },
    { code: 'hi', label: 'Hindi' },
  ],
};

const TASK_ICONS = {
  Cleaning: Brush,
  Maintenance: Wrench,
  'VIP Treats': Sparkles,
  cleaning: Brush,
  maintenance: Wrench,
  vip_treats: Sparkles,
};

const FieldView = ({ clockInOnly = false, autoClockInOnScan = false }) => {
  const { t } = useTranslations();
  const { fieldLanguage, setFieldLanguage, market, staffProfile, setStaffProfile, addNotification } = useStore();
  const marketKey = market === 'IL' ? 'IL' : 'US';
  const languages = MARKET_LANGUAGES[marketKey] || MARKET_LANGUAGES.US;
  const [staffIdInput, setStaffIdInput] = useState(staffProfile.staffId || '');
  const [staffNameInput, setStaffNameInput] = useState(staffProfile.name || '');
  const [staffPhoneInput, setStaffPhoneInput] = useState(staffProfile.phone || '');
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [toast, setToast] = useState('');
  const [pointsToast, setPointsToast] = useState('');
  const [levelToast, setLevelToast] = useState('');
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueTask, setIssueTask] = useState(null);
  const [issueNote, setIssueNote] = useState('');
  const [issuePhoto, setIssuePhoto] = useState(null);
  const [issueSending, setIssueSending] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [pendingFinishTask, setPendingFinishTask] = useState(null);
  const [taskActionLoading, setTaskActionLoading] = useState({});
  const videoRef = useRef(null);
  const finishPhotoRef = useRef(null);
  const scanLoopRef = useRef(null);
  const prevTaskCountRef = useRef(0);
  const autoClockInRef = useRef(false);
  const staffProfileRef = useRef(staffProfile);
  const prevGoldPointsRef = useRef(staffProfile.goldPoints || 0);

  useEffect(() => {
    staffProfileRef.current = staffProfile;
  }, [staffProfile]);

  useEffect(() => {
    const allowed = languages.map((lang) => lang.code);
    if (!allowed.includes(fieldLanguage)) {
      setFieldLanguage(allowed[0]);
    }
  }, [fieldLanguage, languages, setFieldLanguage]);

  useEffect(() => {
    const syncWorkerLanguage = async () => {
      try {
        await setWorkerLanguage(fieldLanguage);
      } catch (error) {
        console.error('Failed to sync worker language:', error);
      }
    };
    syncWorkerLanguage();
  }, [fieldLanguage]);

  useEffect(() => {
    const stopCamera = () => {
      if (scanLoopRef.current) {
        cancelAnimationFrame(scanLoopRef.current);
      }
      const stream = videoRef.current?.srcObject;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      }
    };
    if (!cameraOn) {
      stopCamera();
      return;
    }
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const scan = async () => {
            if (!videoRef.current) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes && barcodes.length > 0) {
                const value = barcodes[0].rawValue || '';
                if (value) {
                  setStaffIdInput(value);
                  setToast(t('field.toast.qrScanned'));
                  setTimeout(() => setToast(''), 1500);
                  if (autoClockInOnScan && !autoClockInRef.current) {
                    autoClockInRef.current = true;
                    handleClockIn(value);
                  }
                  setCameraOn(false);
                  return;
                }
              }
            } catch (error) {
              // ignore scan errors
            }
            scanLoopRef.current = requestAnimationFrame(scan);
          };
          scanLoopRef.current = requestAnimationFrame(scan);
        }
      } catch (error) {
        setToast(t('field.toast.cameraUnavailable'));
        setTimeout(() => setToast(''), 2000);
        setCameraOn(false);
      }
    };
    start();
    return stopCamera;
  }, [cameraOn]);

  useEffect(() => {
    const loadTasks = async () => {
      if (!staffProfile.staffId) return;
      setLoadingTasks(true);
      try {
        const data = await getStaffTasks(staffProfile.staffId);
        setTasks(data);
      } catch (error) {
        console.error('Failed to load tasks:', error);
      } finally {
        setLoadingTasks(false);
      }
    };
    loadTasks();
  }, [staffProfile.staffId]);

  useEffect(() => {
    if (!staffProfile.staffId || clockInOnly) return;
    const interval = setInterval(async () => {
      try {
        const data = await getStaffTasks(staffProfile.staffId);
        setTasks(data);
      } catch (error) {
        // ignore polling errors
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [staffProfile.staffId, clockInOnly]);

  useEffect(() => {
    const count = tasks.length;
    if (count > prevTaskCountRef.current) {
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.05;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => {
          osc.stop();
          ctx.close();
        }, 150);
      } catch (error) {
        // audio not available
      }
      setToast(t('field.toast.newTask'));
      setTimeout(() => setToast(''), 1500);
    }
    prevTaskCountRef.current = count;
  }, [tasks]);

  useEffect(() => {
    if (!staffProfile.staffId) return;
    const source = subscribeToStaff((update) => {
      const current = staffProfileRef.current;
      if (update?.id !== current.staffId) return;
      setStaffProfile({
        ...current,
        goldPoints: update.gold_points ?? current.goldPoints,
        rank: update.rank ?? current.rank,
        rankTier: update.rank_tier ?? current.rankTier,
      });
    });
    return () => {
      if (source && source.close) source.close();
    };
  }, [staffProfile.staffId, setStaffProfile]);

  const handleClockIn = async (overrideStaffId) => {
    const staffIdValue = overrideStaffId || staffIdInput;
    if (!staffIdValue) return;
    try {
      const payload = {
        staff_id: staffIdValue,
        name: staffNameInput,
        phone: staffPhoneInput,
      };
      if (!staffProfile.language) {
        payload.language = fieldLanguage;
      }
      const result = await clockInStaff(payload);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            updateStaffLocation(
              result.id,
              position.coords.latitude,
              position.coords.longitude
            ).catch(() => {});
          },
          () => {}
        );
      }
      setStaffProfile({
        staffId: result.id,
        name: result.name,
        phone: result.phone,
        goldPoints: result.gold_points ?? result.points ?? 0,
        rank: result.rank ?? null,
        rankTier: result.rank_tier || staffProfile.rankTier || 'starter',
        language: result.language || staffProfile.language || fieldLanguage,
      });
      if (result.language) {
        setFieldLanguage(result.language);
      }
      if (!clockInOnly) {
        const data = await getStaffTasks(result.id);
        setTasks(data);
      }
      setToast(t('field.toast.clockedIn'));
      setTimeout(() => setToast(''), 1500);
      autoClockInRef.current = false;
    } catch (error) {
      console.error('Clock-in failed:', error);
      autoClockInRef.current = false;
    }
  };

  const handleTaskUpdate = async (taskId, status) => {
    const task = tasks.find((item) => item.id === taskId);
    const actionKey = `${taskId}-${status}`;
    setTaskActionLoading((prev) => ({ ...prev, [actionKey]: true }));
    try {
      const result = await updateStaffTaskStatus(taskId, status);
      const data = await getStaffTasks(staffProfile.staffId);
      setTasks(data);
      if (result?.gold_points !== undefined || result?.rank !== undefined || result?.rank_tier) {
        setStaffProfile({
          ...staffProfile,
          goldPoints: result.gold_points ?? staffProfile.goldPoints,
          rank: result.rank ?? staffProfile.rank,
          rankTier: result.rank_tier ?? staffProfile.rankTier,
        });
      }
      if (status === 'finished' && result?.points_awarded !== undefined) {
        const pointsMessage = t('field.toast.goldPoints', { count: result.points_awarded });
        setPointsToast(pointsMessage);
        setTimeout(() => setPointsToast(''), 1800);
      }
      if (task?.room) {
        addNotification({
          type: status === 'finished' ? 'success' : 'activity',
          action: status,
          room: task.room,
          title: t('activity.title', { room: task.room }),
        });
      }
      setToast(status === 'finished' ? t('field.toast.roomReady') : t('field.toast.taskUpdated'));
      setTimeout(() => setToast(''), 1500);
    } catch (error) {
      console.error('Failed to update task:', error);
    } finally {
      setTaskActionLoading((prev) => ({ ...prev, [actionKey]: false }));
    }
  };

  const handleFinishClick = (task) => {
    if (taskActionLoading[`${task.id}-finished`]) return;
    setTaskActionLoading((prev) => ({ ...prev, [`${task.id}-finished`]: true }));
    setPendingFinishTask(task);
    if (finishPhotoRef.current) {
      finishPhotoRef.current.value = '';
      finishPhotoRef.current.click();
    }
  };

  const handleFinishPhotoSelected = (event) => {
    const file = event.target.files?.[0];
    if (!pendingFinishTask) return;
    if (!file) {
      setTaskActionLoading((prev) => ({ ...prev, [`${pendingFinishTask.id}-finished`]: false }));
      setPendingFinishTask(null);
      return;
    }
    handleTaskUpdate(pendingFinishTask.id, 'finished');
    setPendingFinishTask(null);
  };

  const openIssueModal = (task) => {
    setIssueTask(task);
    setIssueNote('');
    setIssuePhoto(null);
    setShowIssueModal(true);
  };

  const handleIssueSubmit = async () => {
    if (!issueTask || !issuePhoto) return;
    setIssueSending(true);
    try {
      await reportIssue({
        roomId: issueTask.room_id,
        roomName: issueTask.room,
        taskId: issueTask.id,
        note: issueNote,
        photo: issuePhoto,
      });
      if (issueTask?.room) {
        addNotification({
          type: 'damage',
          action: 'damage_reported',
          room: issueTask.room,
          title: t('activity.damageReported', { room: issueTask.room }),
          message: issueNote || '',
        });
      }
      setToast(t('field.toast.issueReported'));
      setTimeout(() => setToast(''), 1500);
      setShowIssueModal(false);
    } catch (error) {
      console.error('Failed to report issue:', error);
    } finally {
      setIssueSending(false);
    }
  };

  const goldPoints = staffProfile.goldPoints || 0;
  const goldTier = goldPoints >= 100 ? 3 : goldPoints >= 50 ? 2 : goldPoints >= 10 ? 1 : 0;

  useEffect(() => {
    const prev = prevGoldPointsRef.current;
    if (prev < 100 && goldPoints >= 100) {
      const levelMessage = t('field.toast.levelUp');
      setLevelToast(levelMessage);
      setTimeout(() => setLevelToast(''), 2200);
    }
    prevGoldPointsRef.current = goldPoints;
  }, [goldPoints, marketKey, staffProfile.rankTier]);

  useEffect(() => {
    if (!staffProfile.staffId || !navigator.geolocation) return () => {};
    const updateLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          updateStaffLocation(
            staffProfile.staffId,
            position.coords.latitude,
            position.coords.longitude
          ).catch(() => {});
        },
        () => {}
      );
    };
    updateLocation();
    const interval = setInterval(updateLocation, 120000);
    return () => clearInterval(interval);
  }, [staffProfile.staffId]);

  return (
    <div className={`field-view gold-tier-${goldTier}`}>
      <input
        ref={finishPhotoRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFinishPhotoSelected}
      />
      <div className="field-header">
        <div className="field-title">
          <h2>{t('field.title')}</h2>
          <span className="field-subtitle">{t('field.subtitle')}</span>
        </div>
        {staffProfile.staffId && (
          <div className="field-rank">
            <span className="field-rank-label">{t('field.rank')}</span>
            <span className="field-rank-value">{staffProfile.rank ?? '-'}</span>
            <span className="field-rank-points">{t('field.points', { count: staffProfile.goldPoints ?? 0 })}</span>
            <span className="field-rank-tier">{t(`field.rankTier.${staffProfile.rankTier || 'starter'}`)}</span>
          </div>
        )}
        <div className="field-lang-toggle">
          <Languages size={16} />
          <div className="field-lang-options">
            {languages.map((lang) => (
              <button
                key={lang.code}
                className={`field-lang-btn ${fieldLanguage === lang.code ? 'active' : ''}`}
                onClick={() => setFieldLanguage(lang.code)}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="field-task-list">
        <div className="field-clockin glass-card">
              <h3>{t('field.clockIn.title')}</h3>
          <div className="clockin-form">
            <input
              type="text"
                  placeholder={t('field.clockIn.scanPlaceholder')}
              value={staffIdInput}
              onChange={(e) => setStaffIdInput(e.target.value)}
            />
            <button className="btn-secondary" onClick={() => setCameraOn((prev) => !prev)}>
                  {cameraOn ? t('field.clockIn.stopCamera') : t('field.clockIn.scanQr')}
            </button>
            <input
              type="text"
                  placeholder={t('field.clockIn.nameOptional')}
              value={staffNameInput}
              onChange={(e) => setStaffNameInput(e.target.value)}
            />
            <input
              type="tel"
                  placeholder={t('field.clockIn.phoneOptional')}
              value={staffPhoneInput}
              onChange={(e) => setStaffPhoneInput(e.target.value)}
            />
            <button className="btn-primary" onClick={handleClockIn}>
                  {t('field.clockIn.button')}
            </button>
          </div>
          {cameraOn && (
            <div className="camera-preview">
              <video ref={videoRef} muted playsInline />
            </div>
          )}
        </div>

        {!clockInOnly && (
          <>
            {loadingTasks && <div className="field-loading">{t('field.loadingTasks')}</div>}
            {tasks.map((task) => {
              const taskTypeKey = (task.task_type || '').toString().toLowerCase().replace(/\s+/g, '_');
              const Icon = TASK_ICONS[task.task_type] || TASK_ICONS[taskTypeKey] || CheckCircle2;
              const isActiveTask = task.status !== 'finished' && Boolean(task.room_id);
              const taskLabel = t(`field.taskTypes.${taskTypeKey}`, { defaultValue: task.task_type });
              return (
                <div key={task.id} className={`field-task-card ${task.status}`}>
                  <div className="task-main">
                    <div className="task-icon">
                      <Icon size={18} />
                    </div>
                    <div className="task-info">
                      <span className="task-title">{taskLabel}</span>
                      <span className="task-meta">{task.room}</span>
                    </div>
                    {isActiveTask && (
                      <button
                        className="task-issue-btn"
                        onClick={() => openIssueModal(task)}
                        aria-label={t('field.reportIssue')}
                      >
                        <AlertTriangle size={14} />
                        {t('field.reportIssue')}
                      </button>
                    )}
                  </div>
                  <div className="task-actions">
                    <button
                      className="task-action-btn"
                      onClick={() => handleTaskUpdate(task.id, 'on_my_way')}
                      disabled={task.status === 'finished' || taskActionLoading[`${task.id}-on_my_way`]}
                    >
                      {taskActionLoading[`${task.id}-on_my_way`] ? t('common.loading') : t('field.actions.onMyWay')}
                    </button>
                    <button
                      className="task-action-btn"
                      onClick={() => handleTaskUpdate(task.id, 'started')}
                      disabled={task.status === 'finished' || taskActionLoading[`${task.id}-started`]}
                    >
                      {taskActionLoading[`${task.id}-started`] ? t('common.loading') : t('field.actions.cleaning')}
                    </button>
                    <button
                      className="task-action-btn primary"
                      onClick={() => handleFinishClick(task)}
                      disabled={task.status === 'finished' || taskActionLoading[`${task.id}-finished`]}
                    >
                      {taskActionLoading[`${task.id}-finished`] ? t('common.loading') : t('field.actions.finishedWithPhoto')}
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
      {toast && <div className="field-toast">{toast}</div>}
      {pointsToast && <div className="field-toast points-toast">{pointsToast}</div>}
      {levelToast && <div className="field-toast level-toast">{levelToast}</div>}
      {showIssueModal && (
        <div className="report-modal-backdrop is-open" onClick={() => setShowIssueModal(false)}>
          <div className="report-modal glass-card" onClick={(e) => e.stopPropagation()}>
            <div className="report-header">
              <h2>{t('field.issueModal.title')}</h2>
              <button onClick={() => setShowIssueModal(false)} className="close-btn">×</button>
            </div>
            <div className="report-content">
              <div className="issue-form">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setIssuePhoto(e.target.files?.[0] || null)}
                />
                <textarea
                  placeholder={t('field.issueModal.notePlaceholder')}
                  value={issueNote}
                  onChange={(e) => setIssueNote(e.target.value)}
                />
                <button className="btn-primary" onClick={handleIssueSubmit} disabled={issueSending || !issuePhoto}>
                  {issueSending ? t('field.issueModal.sending') : t('field.issueModal.submit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FieldView;
