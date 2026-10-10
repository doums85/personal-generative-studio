'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, workspaceUrl } from '@/lib/studio/client';

const StudioContext = createContext(null);
const ACTIVE_KEY = 'studio:active-workspace';

export function StudioProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceId, setWorkspaceIdState] = useState(null);
  const [elements, setElements] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [catalog, setCatalog] = useState({ image: [], video: [], audio: [] });
  const [catalogError, setCatalogError] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [activeJobs, setActiveJobs] = useState([]);
  const workspaceIdRef = useRef(null);
  workspaceIdRef.current = workspaceId;

  const toast = useCallback((message, tone = 'info', ttl = 6000) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), ttl);
  }, []);

  const loadWorkspaces = useCallback(async () => {
    const payload = await api.get('/api/studio/workspaces');
    setWorkspaces(payload.workspaces);
    return payload.workspaces;
  }, []);

  const loadWorkspaceData = useCallback(async (id) => {
    if (!id) return;
    const payload = await api.get(workspaceUrl(id, '/summary'));
    if (workspaceIdRef.current !== id) return;
    setElements(payload.elements);
    setGenerations(payload.generations);
    setWorkspaces((current) => current.map((item) => (item.id === id ? { ...item, ...payload.workspace } : item)));
  }, []);

  const setWorkspaceId = useCallback((id) => {
    setWorkspaceIdState(id);
    try { window.localStorage.setItem(ACTIVE_KEY, id); } catch { /* optional */ }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await loadWorkspaces();
        if (!active) return;
        let stored = null;
        try { stored = window.localStorage.getItem(ACTIVE_KEY); } catch { /* optional */ }
        const chosen = list.find((item) => item.id === stored) || list[0];
        if (chosen) setWorkspaceId(chosen.id);
        setStatus('ready');
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message);
        setStatus('error');
      }
    })();
    api.get('/api/gateway/models')
      .then((payload) => active && setCatalog({ image: payload.byModality?.image || [], video: payload.byModality?.video || [], audio: (payload.byModality?.audio || []).filter((model) => model.operation === 'speech') }))
      .catch(() => active && setCatalogError('Le catalogue AI Gateway est indisponible : vérifiez la clé et la connexion.'));
    return () => { active = false; };
  }, [loadWorkspaces, setWorkspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    setElements([]);
    setGenerations([]);
    loadWorkspaceData(workspaceId).catch((loadError) => toast(loadError.message, 'error'));
  }, [workspaceId, loadWorkspaceData, toast]);

  const refresh = useCallback(async () => {
    await Promise.all([loadWorkspaces(), loadWorkspaceData(workspaceIdRef.current)]);
  }, [loadWorkspaces, loadWorkspaceData]);

  const trackJob = useCallback(async (label, promise) => {
    const id = `${Date.now()}-${Math.random()}`;
    setActiveJobs((current) => [...current, { id, label, startedAt: Date.now() }]);
    try {
      return await promise;
    } finally {
      setActiveJobs((current) => current.filter((job) => job.id !== id));
    }
  }, []);

  const value = useMemo(() => ({
    status,
    error,
    workspaces,
    workspace: workspaces.find((item) => item.id === workspaceId) || null,
    workspaceId,
    setWorkspaceId,
    elements,
    generations,
    catalog,
    catalogError,
    refresh,
    loadWorkspaces,
    toast,
    toasts,
    activeJobs,
    trackJob,
    upsertGeneration: (generation) => setGenerations((current) => [generation, ...current.filter((item) => item.id !== generation.id)]),
    removeGeneration: (id) => setGenerations((current) => current.filter((item) => item.id !== id)),
    upsertElement: (element) => setElements((current) => [element, ...current.filter((item) => item.id !== element.id)]),
    removeElement: (id) => setElements((current) => current.filter((item) => item.id !== id)),
  }), [status, error, workspaces, workspaceId, setWorkspaceId, elements, generations, catalog, catalogError, refresh, loadWorkspaces, toast, toasts, activeJobs, trackJob]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error('useStudio must be used inside StudioProvider');
  return context;
}
