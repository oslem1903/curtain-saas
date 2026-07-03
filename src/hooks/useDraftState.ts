import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for managing form draft state with localStorage persistence.
 * Automatically saves all changes to localStorage and restores on component init.
 *
 * Usage:
 *   const [formState, setFormState, clearDraft] = useDraftState('my-form', {
 *     customerName: '',
 *     phone: '',
 *     address: '',
 *   });
 */

export function useDraftState<T extends Record<string, any>>(
  draftKey: string,
  initialValues: T,
): [T, (updates: Partial<T>) => void, () => void] {
  // Load from localStorage or use initialValues
  const getSavedState = (): T => {
    if (typeof window === 'undefined') return initialValues;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with initial values to ensure all keys exist
        return { ...initialValues, ...parsed };
      }
    } catch (e) {
      console.warn(`Failed to load draft from localStorage (${draftKey}):`, e);
    }
    return initialValues;
  };

  const [state, setState] = useState<T>(getSavedState());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced auto-save to localStorage
  const saveToDraft = useCallback((newState: T) => {
    // Clear pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce: save after 500ms of no changes
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(newState));
      } catch (e) {
        console.error(`Failed to save draft to localStorage (${draftKey}):`, e);
      }
    }, 500);
  }, [draftKey]);

  // Update state and trigger auto-save
  const updateState = useCallback((updates: Partial<T>) => {
    setState(prevState => {
      const newState = { ...prevState, ...updates };
      saveToDraft(newState);
      return newState;
    });
  }, [saveToDraft]);

  // Clear draft from localStorage
  const clearDraft = useCallback(() => {
    setState(initialValues);
    try {
      localStorage.removeItem(draftKey);
    } catch (e) {
      console.error(`Failed to clear draft from localStorage (${draftKey}):`, e);
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
  }, [draftKey, initialValues]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return [state, updateState, clearDraft];
}
